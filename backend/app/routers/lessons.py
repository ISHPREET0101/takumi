"""Expert review workflow: draft editing, question answering, approval."""
import json
import uuid

from fastapi import APIRouter, HTTPException

from .. import db
from ..schemas import LessonVersionUpdate, QuestionAnswerIn
from ..services import validation as val

router = APIRouter(prefix="/api", tags=["lessons"])

STEP_KEYS = (
    "id", "title", "instructions", "rationale", "success_cues",
    "common_mistakes", "recovery", "evidence", "simulator",
)


def _version_summary(c, row) -> dict:
    return {
        "id": row["id"],
        "lesson_id": row["lesson_id"],
        "version_number": row["version_number"],
        "title": row["title"],
        "status": row["status"],
        "provenance": row["provenance"],
        "provider": row["provider"],
        "model": row["model"],
        "cached": bool(row["cached"]),
        "created_at": row["created_at"],
        "approved_at": row["approved_at"],
        "changelog": row["changelog"],
    }


def _version_detail(c, row) -> dict:
    body = _version_summary(c, row)
    body["summary"] = row["summary"]
    body["steps"] = json.loads(row["steps_json"])
    body["questions"] = json.loads(row["questions_json"])
    lesson = c.execute("SELECT * FROM lessons WHERE id=?", (row["lesson_id"],)).fetchone()
    if lesson:
        body["lesson"] = {
            "id": lesson["id"],
            "recording_id": lesson["recording_id"],
            "approved_version_id": lesson["approved_version_id"],
        }
    return body


def _get_version(c, version_id: str):
    row = c.execute("SELECT * FROM lesson_versions WHERE id=?", (version_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "lesson version not found")
    return row


def _segments_for_lesson(c, recording_id: str | None) -> list[dict]:
    if not recording_id:
        return []
    rows = c.execute(
        "SELECT seg_index, start_s, end_s, text, edited_text FROM transcript_segments "
        "WHERE recording_id=? ORDER BY seg_index",
        (recording_id,),
    ).fetchall()
    return [
        {
            "seg": r["seg_index"], "start": r["start_s"], "end": r["end_s"],
            "text": r["text"], "edited_text": r["edited_text"],
        }
        for r in rows
    ]


@router.get("/lessons")
def list_lessons():
    with db.conn() as c:
        rows = c.execute("SELECT * FROM lessons ORDER BY created_at DESC, rowid DESC").fetchall()
        out = []
        for l in rows:
            cur = c.execute("SELECT * FROM lesson_versions WHERE id=?", (l["current_version_id"],)).fetchone()
            out.append(
                {
                    "id": l["id"],
                    "recording_id": l["recording_id"],
                    "title": l["title"],
                    "created_at": l["created_at"],
                    "approved_version_id": l["approved_version_id"],
                    "current_version": _version_summary(c, cur) if cur else None,
                }
            )
        return out


@router.get("/lessons/{lesson_id}")
def get_lesson(lesson_id: str):
    with db.conn() as c:
        l = c.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
        if l is None:
            raise HTTPException(404, "lesson not found")
        versions = c.execute(
            "SELECT * FROM lesson_versions WHERE lesson_id=? ORDER BY version_number DESC",
            (lesson_id,),
        ).fetchall()
        return {
            "id": l["id"],
            "recording_id": l["recording_id"],
            "title": l["title"],
            "created_at": l["created_at"],
            "approved_version_id": l["approved_version_id"],
            "current_version_id": l["current_version_id"],
            "versions": [_version_summary(c, v) for v in versions],
            "transcript": _segments_for_lesson(c, l["recording_id"]),
            "attempts": _attempts_for(c, lesson_id),
            "recording": _recording_brief(c, l["recording_id"]),
        }


def _recording_brief(c, recording_id: str | None) -> dict | None:
    if not recording_id:
        return None
    r = c.execute(
        "SELECT id, original_name, media_kind, is_demo FROM recordings WHERE id=?", (recording_id,)
    ).fetchone()
    return dict(r) if r else None


def _attempts_for(c, lesson_id: str) -> list[dict]:
    rows = c.execute(
        "SELECT * FROM attempts WHERE lesson_id=? ORDER BY created_at DESC", (lesson_id,)
    ).fetchall()
    return [
        {
            "id": r["id"], "trainee_name": r["trainee_name"], "score": r["score"],
            "duration_ms": r["duration_ms"], "lesson_version_id": r["lesson_version_id"],
            "details": json.loads(r["details_json"]), "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/lesson-versions/{version_id}")
def get_version(version_id: str):
    with db.conn() as c:
        row = _get_version(c, version_id)
        body = _version_detail(c, row)
        l = c.execute("SELECT recording_id FROM lessons WHERE id=?", (row["lesson_id"],)).fetchone()
        body["transcript"] = _segments_for_lesson(c, l["recording_id"] if l else None)
        return body


@router.put("/lesson-versions/{version_id}")
def update_version(version_id: str, body: LessonVersionUpdate):
    with db.conn() as c:
        row = _get_version(c, version_id)
        lesson = c.execute("SELECT * FROM lessons WHERE id=?", (row["lesson_id"],)).fetchone()
        segments = _segments_for_lesson(c, lesson["recording_id"])
        segs_for_val = [{"text": s["text"], "edited_text": s["edited_text"]} for s in segments]

        steps = [s.model_dump() for s in body.steps]
        questions = [q.model_dump() for q in body.questions]

        errors = val.validate_version_payload(body.title, steps, segs_for_val)
        if errors:
            raise HTTPException(422, detail={"message": "validation failed", "errors": errors})

        target_id = row["id"]
        if row["status"] == "approved":
            # Editing an approved version always creates a fresh draft version.
            next_num = row["version_number"] + 1
            target_id = str(uuid.uuid4())
            c.execute(
                "INSERT INTO lesson_versions(id, lesson_id, version_number, title, summary, steps_json, "
                "questions_json, status, provenance, provider, model, cached, created_at, changelog) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    target_id, row["lesson_id"], next_num, body.title, body.summary,
                    db.dumps(steps), db.dumps(questions), "draft", row["provenance"],
                    row["provider"], row["model"], row["cached"], db.now_iso(),
                    body.changelog or f"revised from v{row['version_number']}",
                ),
            )
            c.execute("UPDATE lessons SET current_version_id=? WHERE id=?", (target_id, row["lesson_id"]))
        else:
            c.execute(
                "UPDATE lesson_versions SET title=?, summary=?, steps_json=?, questions_json=?, changelog=? "
                "WHERE id=?",
                (body.title, body.summary, db.dumps(steps), db.dumps(questions),
                 body.changelog or row["changelog"], version_id),
            )
        return {"id": target_id, "status": "draft"}


@router.post("/lesson-versions/{version_id}/questions/{question_id}")
def answer_question(version_id: str, question_id: str, body: QuestionAnswerIn):
    with db.conn() as c:
        row = _get_version(c, version_id)
        questions = json.loads(row["questions_json"])
        target = next((q for q in questions if q["id"] == question_id), None)
        if target is None:
            raise HTTPException(404, "question not found")
        if body.dismiss:
            target["status"] = "dismissed"
            target["answer"] = ""
        else:
            if not (body.answer or "").strip():
                raise HTTPException(422, "answer must not be empty (or send dismiss=true)")
            target["status"] = "answered"
            target["answer"] = body.answer.strip()
        c.execute(
            "UPDATE lesson_versions SET questions_json=? WHERE id=?",
            (db.dumps(questions), version_id),
        )
        return {"id": question_id, "status": target["status"], "answer": target["answer"]}


@router.post("/lesson-versions/{version_id}/approve")
def approve_version(version_id: str):
    with db.conn() as c:
        row = _get_version(c, version_id)
        if row["status"] == "approved":
            raise HTTPException(409, "version already approved")

        steps = json.loads(row["steps_json"])
        questions = json.loads(row["questions_json"])
        lesson = c.execute("SELECT * FROM lessons WHERE id=?", (row["lesson_id"],)).fetchone()
        segments = _segments_for_lesson(c, lesson["recording_id"])
        segs_for_val = [{"text": s["text"], "edited_text": s["edited_text"]} for s in segments]

        errors = val.validate_version_payload(row["title"], steps, segs_for_val)
        errors += val.approval_blockers(questions)
        if errors:
            raise HTTPException(422, detail={"message": "cannot approve yet", "errors": errors})

        now = db.now_iso()
        c.execute(
            "UPDATE lesson_versions SET status='approved', approved_at=? WHERE id=?", (now, version_id)
        )
        c.execute(
            "UPDATE lessons SET approved_version_id=?, current_version_id=?, title=? WHERE id=?",
            (version_id, version_id, row["title"], row["lesson_id"]),
        )
        return {"id": version_id, "status": "approved", "approved_at": now}


@router.get("/lessons/{lesson_id}/attempts")
def lesson_attempts(lesson_id: str):
    with db.conn() as c:
        l = c.execute("SELECT id FROM lessons WHERE id=?", (lesson_id,)).fetchone()
        if l is None:
            raise HTTPException(404, "lesson not found")
        return _attempts_for(c, lesson_id)
