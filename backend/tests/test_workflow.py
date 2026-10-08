"""End-to-end backend verification for the Takumi workflow.

Covers the automatable checks from the plan's verification list:
seed/sample processing, approval gating, trainee visibility of approved-only
lessons, evidence-reference rejection, attempt storage tied to the approved
version, persistence across restart, malformed provider responses, explicit
provider failure (no silent switching), extraction caching, and transcript-edit
interplay with evidence matching.
"""
import json
import os
import sys
import time
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

FIXTURE = json.loads((BACKEND_DIR / "fixtures" / "sample_oscilloscope_demo.json").read_text(encoding="utf-8"))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Isolated app per test: temp data dir, seeded sample, no real whisper calls."""
    monkeypatch.setenv("TAKUMI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TAKUMI_NVIDIA_ENABLED", "false")
    monkeypatch.setenv("TAKUMI_NVIDIA_API_KEY", "")
    monkeypatch.setenv("TAKUMI_EXTRACTION_PROVIDER", "saved_demo")
    from app import config as config_mod

    monkeypatch.setattr(config_mod, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(config_mod, "RECORDINGS_DIR", tmp_path / "data" / "recordings")
    monkeypatch.setattr(config_mod, "DB_PATH", tmp_path / "data" / "takumi.db")
    monkeypatch.setattr(config_mod, "EXTRACTION_PROVIDER", "saved_demo")
    monkeypatch.setattr(config_mod, "NVIDIA_ENABLED", False)
    monkeypatch.setattr(config_mod, "NVIDIA_API_KEY", "")

    from app.services import transcription as tr_mod

    monkeypatch.setattr(tr_mod, "transcribe", lambda path, on_progress=None: (_segments_from_fixture(), 214.0))
    monkeypatch.setattr(tr_mod, "media_duration", lambda path: 214.0)
    monkeypatch.setattr(tr_mod, "whisper_available", lambda: True)

    import app.jobs as jobs_mod  # noqa: F401  (import to ensure module wiring)

    from app.main import app

    with TestClient(app) as c:
        yield c


def _segments_from_fixture():
    return [
        {"start": s["start"], "end": s["end"], "text": s["text"]} for s in FIXTURE["transcript"]
    ]


def _wait_job(client, recording_id, timeout=20.0, expect=None):
    deadline = time.time() + timeout
    while time.time() < deadline:
        recs = client.get("/api/recordings").json()
        rec = next(r for r in recs if r["id"] == recording_id)
        job = rec["job"]
        if job["status"] not in ("queued", "running"):
            if expect:
                assert job["status"] == expect, f"expected {expect}, got {job['status']}: {job.get('error')}"
            return rec, job
        time.sleep(0.15)
    raise AssertionError("job did not finish in time")


def _upload_wav(client, seconds=2):
    """Upload a tiny real WAV (bypasses whisper via the fixture monkeypatch)."""
    import io

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 8000 * seconds)
    buf.seek(0)
    res = client.post("/api/recordings", files={"file": ("bench_note.wav", buf, "audio/wav")})
    assert res.status_code == 200, res.text
    return res.json()


def _approve_everything(client, version_id):
    v = client.get(f"/api/lesson-versions/{version_id}").json()
    for q in v["questions"]:
        r = client.post(
            f"/api/lesson-versions/{version_id}/questions/{q['id']}",
            json={"answer": f"Expert answer to: {q['question']}", "dismiss": False},
        )
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------- tests


def test_seed_creates_demo_and_processes(client):
    recs = client.get("/api/recordings").json()
    demos = [r for r in recs if r["is_demo"]]
    assert len(demos) == 1
    rec, job = _wait_job(client, demos[0]["id"], expect="succeeded")
    assert job["provider"] == "saved_demo"
    assert job["lesson_id"]

    detail = client.get(f"/api/recordings/{rec['id']}").json()
    assert len(detail["transcript"]) == len(FIXTURE["transcript"])

    lessons = client.get("/api/lessons").json()
    assert lessons[0]["current_version"]["provenance"] == "saved_demo"


def test_trainee_cannot_see_unapproved_then_can_after_approval(client):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    lesson_id = job["lesson_id"]

    # Not approved yet -> hidden from the trainee list and 403 on direct fetch
    cards = client.get("/api/trainee/lessons").json()
    assert cards == []
    assert client.get(f"/api/trainee/lessons/{lesson_id}").status_code == 403

    # Approval blocked while a question is unresolved
    lesson = client.get(f"/api/lessons/{lesson_id}").json()
    version_id = lesson["current_version_id"]
    r = client.post(f"/api/lesson-versions/{version_id}/approve")
    assert r.status_code == 422
    assert any("unresolved" in e for e in r.json()["detail"]["errors"])

    _approve_everything(client, version_id)
    r = client.post(f"/api/lesson-versions/{version_id}/approve")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    cards = client.get("/api/trainee/lessons").json()
    assert [c["id"] for c in cards] == [lesson_id]
    tl = client.get(f"/api/trainee/lessons/{lesson_id}").json()
    assert tl["version_number"] == 1
    assert len(tl["steps"]) == len(FIXTURE["extraction"]["steps"])


def test_invalid_evidence_reference_rejected(client):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    lesson = client.get(f"/api/lessons/{job['lesson_id']}").json()
    vid = lesson["current_version_id"]
    v = client.get(f"/api/lesson-versions/{vid}").json()

    steps = json.loads(json.dumps(v["steps"]))
    steps[0]["evidence"][0]["seg"] = 999
    r = client.put(
        f"/api/lesson-versions/{vid}",
        json={"title": v["title"], "summary": v["summary"], "steps": steps, "questions": v["questions"]},
    )
    assert r.status_code == 422
    assert any("out of range" in e for e in r.json()["detail"]["errors"])

    # non-matching quote also rejected
    steps[0]["evidence"][0]["seg"] = 0
    steps[0]["evidence"][0]["quote"] = "this quote appears nowhere in the transcript"
    r = client.put(
        f"/api/lesson-versions/{vid}",
        json={"title": v["title"], "summary": v["summary"], "steps": steps, "questions": v["questions"]},
    )
    assert r.status_code == 422
    assert any("does not match" in e for e in r.json()["detail"]["errors"])


def test_attempt_stored_and_tied_to_approved_version(client):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    lesson_id = job["lesson_id"]
    lesson = client.get(f"/api/lessons/{lesson_id}").json()
    vid = lesson["current_version_id"]
    _approve_everything(client, vid)
    assert client.post(f"/api/lesson-versions/{vid}/approve").status_code == 200

    tl = client.get(f"/api/trainee/lessons/{lesson_id}").json()
    steps_payload = [
        {"step_id": s["id"], "title": s["title"], "passed": True, "wrong_adjustments": 0, "assists": 0, "time_ms": 4000}
        for s in tl["steps"]
    ]
    r = client.post(
        f"/api/trainee/lessons/{lesson_id}/attempts",
        json={"trainee_name": "Aarav", "duration_ms": 60000, "steps": steps_payload},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] == 100
    assert body["lesson_version_id"] == vid  # tied to the approved version

    # attempts referencing steps outside the approved version are rejected
    r = client.post(
        f"/api/trainee/lessons/{lesson_id}/attempts",
        json={
            "trainee_name": "Aarav",
            "duration_ms": 1000,
            "steps": [{"step_id": "ghost-step", "passed": True}],
        },
    )
    assert r.status_code == 422

    attempts = client.get(f"/api/lessons/{lesson_id}/attempts").json()
    assert len(attempts) == 1
    assert attempts[0]["trainee_name"] == "Aarav"


def test_attempt_score_recomputed_server_side(client):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    lesson_id = job["lesson_id"]
    lesson = client.get(f"/api/lessons/{lesson_id}").json()
    vid = lesson["current_version_id"]
    _approve_everything(client, vid)
    client.post(f"/api/lesson-versions/{vid}/approve")

    tl = client.get(f"/api/trainee/lessons/{lesson_id}").json()
    steps_payload = [
        {"step_id": s["id"], "passed": True, "wrong_adjustments": 2, "assists": 1, "time_ms": 9000}
        for s in tl["steps"]
    ]
    r = client.post(
        f"/api/trainee/lessons/{lesson_id}/attempts",
        json={"trainee_name": "Mehar", "duration_ms": 90000, "steps": steps_payload},
    )
    # 1 - 0.25*2 - 0.15*1 = 0.35 per step -> 35, regardless of what client claims
    assert r.json()["score"] == 35


def test_persistence_and_interrupted_jobs_marked_failed(client, tmp_path):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")

    # simulate a restart: orphaned 'running' job is marked failed, data persists
    from app import db as db_mod, jobs as jobs_mod

    with db_mod.conn() as c:
        orphan_id = jobs_mod.create_job(c, rec["id"])
        c.execute("UPDATE jobs SET status='running' WHERE id=?", (orphan_id,))
        n = jobs_mod.mark_orphaned_jobs_failed(c)
        assert n == 1
        row = c.execute("SELECT status, error FROM jobs WHERE id=?", (orphan_id,)).fetchone()
        assert "interrupted" in row["error"]
        # data persisted
        assert c.execute("SELECT COUNT(*) AS n FROM transcript_segments WHERE recording_id=?", (rec["id"],)).fetchone()["n"] > 0
        assert c.execute("SELECT COUNT(*) AS n FROM lessons").fetchone()["n"] >= 1


def test_malformed_provider_response_fails_loudly(client, monkeypatch):
    from app.services import extraction as ex_mod

    monkeypatch.setattr("app.config.EXTRACTION_PROVIDER", "ollama")

    def fake_reachable(timeout=1.0, force=False):
        return True

    monkeypatch.setattr(ex_mod, "ollama_reachable", fake_reachable)
    # Mock at the HTTP layer so the real provider code (incl. JSON parsing) runs:
    # a well-formed HTTP response whose content is not JSON at all.
    monkeypatch.setattr(
        ex_mod,
        "_post_json",
        lambda url, headers, payload, **kw: {"message": {"content": "Sorry, I cannot help with that."}},
    )

    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="failed")
    # explicit provider request fails loudly, without falling back to another provider
    assert job["error"].startswith("extraction failed | ollama:")
    assert "no JSON object" in job["error"]
    assert "saved_demo" not in job["error"]


def test_validation_rejects_bad_model_output(client, monkeypatch):
    from app.services import extraction as ex_mod

    monkeypatch.setattr("app.config.EXTRACTION_PROVIDER", "ollama")
    monkeypatch.setattr(ex_mod, "ollama_reachable", lambda timeout=1.0, force=False: True)

    bad = {
        "title": "Bench notes",
        "summary": "x",
        "steps": [
            {
                "id": "s1",
                "title": "Do the thing",
                "instructions": "Do it carefully.",
                "rationale": "",
                "success_cues": [],
                "common_mistakes": [],
                "recovery": "",
                "evidence": [{"seg": 42, "quote": "nonexistent"}],
            }
        ],
        "questions": [],
    }
    monkeypatch.setattr(ex_mod, "extract_with_ollama", lambda segments: bad)

    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="failed")
    assert "rejected by validation" in job["error"]
    assert "out of range" in job["error"]


def test_full_local_ai_pipeline_creates_lesson_with_provenance(client, monkeypatch):
    """Non-demo recording + (mocked) local model returning the fixture extraction."""
    from app.services import extraction as ex_mod

    monkeypatch.setattr("app.config.EXTRACTION_PROVIDER", "ollama")
    monkeypatch.setattr(ex_mod, "ollama_reachable", lambda timeout=1.0, force=False: True)
    monkeypatch.setattr(ex_mod, "extract_with_ollama", lambda segments: json.loads(json.dumps(FIXTURE["extraction"])))

    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="succeeded")
    assert job["provider"] == "ollama"
    assert job["model"] == "qwen2.5:7b"

    lessons = client.get("/api/lessons").json()
    mine = next(l for l in lessons if l["id"] == job["lesson_id"])
    assert mine["current_version"]["provenance"] == "local_ai"

    # second identical run hits the extraction cache
    r = client.post(f"/api/recordings/{rec['id']}/reprocess")
    assert r.status_code == 200
    rec2, job2 = _wait_job(client, rec["id"], expect="succeeded")
    lessons = client.get("/api/lessons").json()
    cached_lesson = next(l for l in lessons if l["id"] == job2["lesson_id"])
    assert cached_lesson["current_version"]["cached"] is True


def test_explicit_provider_never_silently_switches(client, monkeypatch):
    monkeypatch.setattr("app.config.EXTRACTION_PROVIDER", "nvidia")

    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="failed")
    assert job["error"].startswith("extraction failed | nvidia:")
    assert "NVIDIA NIM not enabled" in job["error"]
    # and it did NOT fall through to saved_demo/ollama
    assert "saved_demo" not in job["error"]
    assert "ollama:" not in job["error"]


def test_auto_mode_falls_downward_only(client, monkeypatch):
    monkeypatch.setattr("app.config.EXTRACTION_PROVIDER", "auto")
    from app.services import extraction as ex_mod

    monkeypatch.setattr(ex_mod, "nvidia_ready", lambda: False)
    monkeypatch.setattr(ex_mod, "ollama_reachable", lambda timeout=1.0, force=False: False)

    # non-demo: nothing below ollama is available -> fail with guidance
    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="failed")
    assert "ollama" in job["error"]

    # demo: falls down to saved_demo and succeeds
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    assert job["provider"] == "saved_demo"


def test_transcript_edit_keeps_original_quotes_valid(client):
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    rec, job = _wait_job(client, demo["id"], expect="succeeded")
    lesson_id = job["lesson_id"]
    lesson = client.get(f"/api/lessons/{lesson_id}").json()
    vid = lesson["current_version_id"]
    v = client.get(f"/api/lesson-versions/{vid}").json()

    seg0 = client.get(f"/api/recordings/{lesson['recording_id']}").json()["transcript"][0]
    r = client.patch(
        f"/api/recordings/{lesson['recording_id']}/transcript/{seg0['seg']}",
        json={"text": "Corrected: the expert says hello and introduces the oscilloscope session."},
    )
    assert r.status_code == 200

    # a step quoting the ORIGINAL text of segment 0 stays valid
    steps = json.loads(json.dumps(v["steps"]))
    steps[0]["evidence"].append({"seg": 0, "quote": seg0["text"][:60]})
    r = client.put(
        f"/api/lesson-versions/{vid}",
        json={"title": v["title"], "summary": v["summary"], "steps": steps, "questions": v["questions"]},
    )
    assert r.status_code == 200, r.text


def test_health_reports_provider_state(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    assert h["providers"]["nvidia"]["enabled"] is False
    assert "free entitlement" in h["providers"]["nvidia"]["note"]
    assert h["providers"]["saved_demo"]["available"] is True


def test_media_range_request_supported(client):
    """Video seeking in the browser needs HTTP Range -> 206 partial content."""
    recs = client.get("/api/recordings").json()
    demo = next(r for r in recs if r["is_demo"])
    r = client.get(f"/api/recordings/{demo['id']}/media", headers={"Range": "bytes=0-1023"})
    assert r.status_code == 206
    assert r.headers["content-range"].startswith("bytes 0-1023/")
    assert len(r.content) == 1024


def test_oversized_recording_fails_fast_before_transcription(client, monkeypatch):
    """A >10 min recording must be rejected in the probe stage, without loading whisper."""
    from app.services import transcription as tr_mod

    monkeypatch.setattr(tr_mod, "media_duration", lambda path: 700.0)

    def _must_not_run(path, on_progress=None):
        raise AssertionError("transcription started despite oversized duration")

    monkeypatch.setattr(tr_mod, "transcribe", _must_not_run)

    rec = _upload_wav(client)
    rec, job = _wait_job(client, rec["id"], expect="failed")
    assert "700s" in job["error"]
    assert "limit is 600s" in job["error"]


def test_health_ollama_probe_is_cached(client, monkeypatch):
    """The header chip polls health often; the Ollama probe must be TTL-cached."""
    from app.services import extraction as ex_mod

    calls = {"n": 0}

    def counting_probe(timeout=1.0, force=False):
        # only count real probes, not cache hits
        if force or time.time() - ex_mod._ollama_probe["ts"] >= ex_mod.OLLAMA_PROBE_TTL_SECONDS:
            calls["n"] += 1
            ex_mod._ollama_probe["ts"] = time.time()
            ex_mod._ollama_probe["ok"] = False
        return ex_mod._ollama_probe["ok"]

    monkeypatch.setattr(ex_mod, "ollama_reachable", counting_probe)
    client.get("/api/health")
    client.get("/api/health")
    client.get("/api/health")
    assert calls["n"] <= 1
