"""Trainee-facing endpoints. ONLY approved lesson versions are ever served here."""
import json
import uuid

from fastapi import APIRouter, HTTPException

from .. import db
from ..schemas import AttemptIn

router = APIRouter(prefix="/api/trainee", tags=["trainee"])


def _approved_version(c, lesson_id: str):
    lesson = c.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
    if lesson is None:
        raise HTTPException(404, "lesson not found")
    if not lesson["approved_version_id"]:
        raise HTTPException(403, "lesson_not_approved")
    version = c.execute(
        "SELECT * FROM lesson_versions WHERE id=?", (lesson["approved_version_id"],)
    ).fetchone()
    if version is None or version["status"] != "approved":
        raise HTTPException(403, "lesson_not_approved")
    return lesson, version


@router.get("/lessons")
def list_approved_lessons():
    with db.conn() as c:
        rows = c.execute(
            "SELECT l.* FROM lessons l WHERE l.approved_version_id IS NOT NULL "
            "ORDER BY l.created_at DESC"
        ).fetchall()
        out = []
        for l in rows:
            v = c.execute(
                "SELECT * FROM lesson_versions WHERE id=?", (l["approved_version_id"],)
            ).fetchone()
            if v is None or v["status"] != "approved":
                continue
            steps = json.loads(v["steps_json"])
            out.append(
                {
                    "id": l["id"],
                    "title": v["title"],
                    "summary": v["summary"],
                    "version_number": v["version_number"],
                    "provenance": v["provenance"],
                    "step_count": len(steps),
                }
            )
        return out


@router.get("/lessons/{lesson_id}")
def get_approved_lesson(lesson_id: str):
    with db.conn() as c:
        lesson, version = _approved_version(c, lesson_id)
        rec = c.execute(
            "SELECT id, original_name, media_kind, is_demo FROM recordings WHERE id=?",
            (lesson["recording_id"],),
        ).fetchone()
        return {
            "id": lesson["id"],
            "version_number": version["version_number"],
            "title": version["title"],
            "summary": version["summary"],
            "steps": json.loads(version["steps_json"]),
            "provenance": version["provenance"],
            "recording": dict(rec) if rec else None,
        }


def _recompute_score(steps: list[dict]) -> int:
    """Server-side integrity check: score derives from per-step results."""
    if not steps:
        return 0
    total = 0.0
    for s in steps:
        if not s["passed"]:
            continue
        total += max(0.0, 1.0 - 0.25 * s["wrong_adjustments"] - 0.15 * s["assists"])
    return max(0, min(100, round(100 * total / len(steps))))


@router.post("/lessons/{lesson_id}/attempts")
def submit_attempt(lesson_id: str, body: AttemptIn):
    with db.conn() as c:
        lesson, version = _approved_version(c, lesson_id)
        steps = json.loads(version["steps_json"])
        valid_ids = {s["id"] for s in steps}
        bad = [s.step_id for s in body.steps if s.step_id not in valid_ids]
        if bad:
            raise HTTPException(422, f"attempt references steps outside the approved version: {bad[:5]}")

        step_details = [s.model_dump() for s in body.steps]
        score = _recompute_score(step_details)
        attempt_id = str(uuid.uuid4())
        c.execute(
            "INSERT INTO attempts(id, lesson_id, lesson_version_id, trainee_name, score, "
            "duration_ms, details_json, created_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                attempt_id, lesson_id, version["id"], body.trainee_name, score,
                body.duration_ms, db.dumps({"steps": step_details}), db.now_iso(),
            ),
        )
        return {
            "id": attempt_id,
            "score": score,
            "lesson_version_id": version["id"],
            "stored": True,
        }


@router.get("/lessons/{lesson_id}/attempts")
def my_attempts(lesson_id: str, trainee: str | None = None):
    with db.conn() as c:
        lesson, _ = _approved_version(c, lesson_id)
        if trainee:
            rows = c.execute(
                "SELECT * FROM attempts WHERE lesson_id=? AND trainee_name=? ORDER BY created_at DESC",
                (lesson_id, trainee.strip()),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM attempts WHERE lesson_id=? ORDER BY created_at DESC", (lesson_id,)
            ).fetchall()
        return [
            {
                "id": r["id"], "trainee_name": r["trainee_name"], "score": r["score"],
                "duration_ms": r["duration_ms"], "created_at": r["created_at"],
            }
            for r in rows
        ]
