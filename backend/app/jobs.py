"""Background processing pipeline: transcribe -> extract -> validate -> draft lesson.

Single bounded worker thread. Job state is persisted so progress survives page
reloads; on startup, jobs left 'running' by a restart are marked failed.
"""
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config, db
from .services import extraction as ex
from .services import transcription as tr
from .services import validation as val

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="takumi-job")
_lock = threading.Lock()


def create_job(c, recording_id: str) -> str:
    job_id = str(uuid.uuid4())
    now = db.now_iso()
    c.execute(
        "INSERT INTO jobs(id, recording_id, status, stage, progress, created_at, updated_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (job_id, recording_id, "queued", "uploading", 0.0, now, now),
    )
    return job_id


def dispatch(job_id: str, recording_id: str) -> None:
    _executor.submit(_run_job, job_id, recording_id)


def set_progress(c, job_id: str, stage: str, progress: float, **fields) -> None:
    sets = ", ".join(f"{k}=?" for k in fields)
    params = list(fields.values())
    c.execute(
        f"UPDATE jobs SET stage=?, progress=?, updated_at=?{', ' + sets if sets else ''} WHERE id=?",
        [stage, progress, db.now_iso(), *params, job_id],
    )


def fail(c, job_id: str, message: str) -> None:
    c.execute(
        "UPDATE jobs SET status='failed', error=?, updated_at=? WHERE id=?",
        (message[:2000], db.now_iso(), job_id),
    )


def _segments_for(c, recording_id: str) -> list[dict]:
    rows = c.execute(
        "SELECT seg_index, start_s, end_s, text, edited_text FROM transcript_segments "
        "WHERE recording_id=? ORDER BY seg_index",
        (recording_id,),
    ).fetchall()
    return [
        {
            "seg": r["seg_index"],
            "start": r["start_s"],
            "end": r["end_s"],
            "text": r["text"],
            "edited_text": r["edited_text"],
        }
        for r in rows
    ]


def _write_segments(c, recording_id: str, segments: list[dict]) -> None:
    c.execute("DELETE FROM transcript_segments WHERE recording_id=?", (recording_id,))
    c.executemany(
        "INSERT INTO transcript_segments(recording_id, seg_index, start_s, end_s, text) VALUES(?,?,?,?,?)",
        [
            (recording_id, i, s["start"], s["end"], s["text"])
            for i, s in enumerate(segments)
        ],
    )


def _create_draft_lesson(c, recording_id: str, title: str, summary: str,
                         steps: list, questions: list, provenance: str,
                         provider: str, model: str, cached: bool) -> str:
    lesson_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    now = db.now_iso()
    norm_questions = [
        {
            "id": f"q{i + 1}",
            "question": q.get("question", ""),
            "why_missing": q.get("why_missing", ""),
            "answer": "",
            "status": "open",
        }
        for i, q in enumerate(questions or [])
    ]
    norm_steps = []
    for i, s in enumerate(steps or []):
        norm_steps.append(
            {
                "id": s.get("id") or f"s{i + 1}",
                "title": s.get("title", ""),
                "instructions": s.get("instructions", ""),
                "rationale": s.get("rationale", ""),
                "success_cues": s.get("success_cues", []),
                "common_mistakes": s.get("common_mistakes", []),
                "recovery": s.get("recovery", ""),
                "evidence": [
                    {"seg": e.get("seg"), "quote": e.get("quote", "")} for e in (s.get("evidence") or [])
                ],
                "simulator": s.get("simulator"),
            }
        )
    c.execute(
        "INSERT INTO lessons(id, recording_id, title, created_at) VALUES(?,?,?,?)",
        (lesson_id, recording_id, title, now),
    )
    c.execute(
        "INSERT INTO lesson_versions(id, lesson_id, version_number, title, summary, steps_json, "
        "questions_json, status, provenance, provider, model, cached, created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            version_id, lesson_id, 1, title, summary,
            db.dumps(norm_steps), db.dumps(norm_questions),
            "draft", provenance, provider, model, 1 if cached else 0, now,
        ),
    )
    c.execute(
        "UPDATE lessons SET current_version_id=? WHERE id=?", (version_id, lesson_id)
    )
    return lesson_id


def _run_job(job_id: str, recording_id: str) -> None:
    with _lock:
        with db.conn() as c:
            rec = c.execute("SELECT * FROM recordings WHERE id=?", (recording_id,)).fetchone()
            if rec is None:
                fail(c, job_id, "recording not found")
                return
            already = c.execute(
                "SELECT COUNT(*) AS n FROM jobs WHERE recording_id=? AND status IN ('queued','running') AND id!=?",
                (recording_id, job_id),
            ).fetchone()["n"]
            if already:
                fail(c, job_id, "another job is already processing this recording")
                return
            c.execute(
                "UPDATE jobs SET status='running', updated_at=? WHERE id=?", (db.now_iso(), job_id)
            )
            try:
                _process(c, job_id, dict(rec))
            except ex.ProviderUnavailable as exc:
                fail(c, job_id, f"no extraction provider available: {exc}")
            except ex.ProviderError as exc:
                fail(c, job_id, f"extraction provider error: {exc}")
            except Exception as exc:  # pragma: no cover - defensive
                fail(c, job_id, f"unexpected processing error: {type(exc).__name__}: {exc}")


def _process(c, job_id: str, rec: dict) -> None:
    recording_id = rec["id"]
    is_demo = bool(rec["is_demo"])
    bundle = rec["demo_bundle"]

    # Stage 1: transcript
    segments = _segments_for(c, recording_id)
    if not segments and is_demo and bundle:
        # The bundled sample ships its transcript; no transcription (or model
        # download) is needed for the offline demo path.
        try:
            with open(bundle, "r", encoding="utf-8") as f:
                fixture = json.load(f)
        except (OSError, ValueError) as exc:
            fail(c, job_id, f"saved demo bundle unreadable: {exc}")
            return
        transcript = fixture.get("transcript") or []
        if not transcript:
            fail(c, job_id, "saved demo bundle has no transcript")
            return
        _write_segments(c, recording_id, transcript)
        c.execute("UPDATE recordings SET duration_sec=? WHERE id=?", (fixture.get("duration_sec"), recording_id))
        segments = _segments_for(c, recording_id)
    if not segments:
        path = Path(rec["stored_path"])
        if not path.exists():
            fail(c, job_id, f"recording file missing on disk: {path.name}")
            return
        if not tr.whisper_available():
            fail(
                c, job_id,
                "faster-whisper is not installed in this environment; install backend "
                "requirements (or use the bundled sample, which needs no transcription)",
            )
            return
        set_progress(c, job_id, "transcribing", 8.0)
        dur = tr.media_duration_fast(path)
        if dur is not None and dur > config.MAX_RECORDING_SECONDS:
            fail(c, job_id, f"recording is {dur:.0f}s; limit is {config.MAX_RECORDING_SECONDS:.0f}s")
            return

        def on_progress(frac: float) -> None:
            set_progress(c, job_id, "transcribing", 8.0 + frac * 32.0)

        try:
            segments, whisper_dur = tr.transcribe(path, on_progress=on_progress)
        except Exception as exc:
            fail(c, job_id, f"transcription failed — audio could not be decoded "
                            f"(corrupt or unsupported file): {exc}")
            return
        if whisper_dur > config.MAX_RECORDING_SECONDS:
            fail(c, job_id, f"recording is {whisper_dur:.0f}s; limit is {config.MAX_RECORDING_SECONDS:.0f}s")
            return
        _write_segments(c, recording_id, segments)
        c.execute("UPDATE recordings SET duration_sec=? WHERE id=?", (whisper_dur, recording_id))
        segments = _segments_for(c, recording_id)
    set_progress(c, job_id, "extracting", 45.0)

    # Stage 2: resolve provider (no silent switching to paid providers)
    requested = config.EXTRACTION_PROVIDER
    chain = ex.resolve_provider(requested, is_demo)
    errors: list[str] = []
    result = None
    used_provider = used_model = None
    was_cached = False
    for candidate in chain:
        try:
            result, used_provider, used_model, was_cached = ex.extract_with_cache(
                c, candidate, segments, {"demo_bundle": bundle}
            )
            break
        except (ex.ProviderUnavailable, ex.ProviderError) as exc:
            errors.append(f"{candidate}: {exc}")
            if requested != "auto":
                break  # explicit request fails loudly
    if result is None:
        fail(c, job_id, "extraction failed | " + " | ".join(errors))
        return
    set_progress(c, job_id, "validating", 78.0, provider=used_provider, model=used_model)

    # Stage 3: validate structure + evidence references
    segs_for_validation = [
        {"text": s["text"], "edited_text": s["edited_text"]} for s in segments
    ]
    errors = val.validate_extraction(result, segs_for_validation)
    if errors:
        fail(c, job_id, "extraction rejected by validation: " + "; ".join(errors[:8]))
        return
    set_progress(c, job_id, "finalizing", 92.0)

    # Stage 4: draft lesson
    lesson_id = _create_draft_lesson(
        c, recording_id,
        title=result["title"], summary=result.get("summary", ""),
        steps=result["steps"], questions=result.get("questions", []),
        provenance=ex.provenance_for(used_provider),
        provider=used_provider, model=used_model, cached=was_cached,
    )
    set_progress(c, job_id, "done", 100.0, status="succeeded", lesson_id=lesson_id)


def mark_orphaned_jobs_failed(c) -> int:
    cur = c.execute(
        "UPDATE jobs SET status='failed', error='interrupted by application restart', "
        "updated_at=? WHERE status IN ('queued','running')",
        (db.now_iso(),),
    )
    return cur.rowcount
