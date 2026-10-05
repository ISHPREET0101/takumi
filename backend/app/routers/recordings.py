"""Recording upload, job status, transcript editing, media streaming."""
import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config, db, jobs
from ..schemas import TranscriptSegmentEdit

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _recording_dict(c, row) -> dict:
    job = c.execute(
        "SELECT * FROM jobs WHERE recording_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    lesson = c.execute("SELECT id, title FROM lessons WHERE recording_id=?", (row["id"],)).fetchone()
    n_seg = c.execute(
        "SELECT COUNT(*) AS n FROM transcript_segments WHERE recording_id=?", (row["id"],)
    ).fetchone()["n"]
    d = {
        "id": row["id"],
        "original_name": row["original_name"],
        "media_kind": row["media_kind"],
        "size_bytes": row["size_bytes"],
        "duration_sec": row["duration_sec"],
        "is_demo": bool(row["is_demo"]),
        "created_at": row["created_at"],
        "segment_count": n_seg,
        "lesson": dict(lesson) if lesson else None,
        "job": dict(job) if job else None,
    }
    return d


@router.post("")
async def upload_recording(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in config.ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"unsupported file type '{ext}'; allowed: {sorted(config.ALLOWED_EXTENSIONS)}")

    recording_id = str(uuid.uuid4())
    stored_name = f"{recording_id}{ext}"
    stored_path = config.RECORDINGS_DIR / stored_name

    hasher = hashlib.sha256()
    size = 0
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    with open(stored_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                out.close()
                stored_path.unlink(missing_ok=True)
                raise HTTPException(413, f"upload exceeds {config.MAX_UPLOAD_MB} MB limit")
            hasher.update(chunk)
            out.write(chunk)
    if size == 0:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(422, "empty upload")

    kind = "audio" if ext in {".m4a", ".mp3", ".wav", ".ogg", ".flac"} else "video"
    with db.conn() as c:
        c.execute(
            "INSERT INTO recordings(id, original_name, stored_path, media_kind, size_bytes, "
            "duration_sec, is_demo, sha256, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (recording_id, file.filename, str(stored_path), kind, size, None, 0, hasher.hexdigest(), db.now_iso()),
        )
        job_id = jobs.create_job(c, recording_id)
    jobs.dispatch(job_id, recording_id)

    with db.conn() as c:
        row = c.execute("SELECT * FROM recordings WHERE id=?", (recording_id,)).fetchone()
        body = _recording_dict(c, row)
    body["job"]["id"] = job_id
    return body


@router.get("")
def list_recordings():
    with db.conn() as c:
        rows = c.execute("SELECT * FROM recordings ORDER BY created_at DESC, rowid DESC").fetchall()
        return [_recording_dict(c, r) for r in rows]


@router.get("/{recording_id}")
def get_recording(recording_id: str):
    with db.conn() as c:
        row = c.execute("SELECT * FROM recordings WHERE id=?", (recording_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "recording not found")
        body = _recording_dict(c, row)
        segs = c.execute(
            "SELECT seg_index, start_s, end_s, text, edited_text FROM transcript_segments "
            "WHERE recording_id=? ORDER BY seg_index",
            (recording_id,),
        ).fetchall()
        body["transcript"] = [
            {
                "seg": s["seg_index"],
                "start": s["start_s"],
                "end": s["end_s"],
                "text": s["text"],
                "edited_text": s["edited_text"],
            }
            for s in segs
        ]
        return body


@router.get("/{recording_id}/media")
def get_media(recording_id: str):
    with db.conn() as c:
        row = c.execute("SELECT stored_path, original_name FROM recordings WHERE id=?", (recording_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "recording not found")
    path = Path(row["stored_path"])
    if not path.exists():
        raise HTTPException(404, "media file missing on disk")
    return FileResponse(path, filename=row["original_name"])


@router.patch("/{recording_id}/transcript/{seg_index}")
def edit_segment(recording_id: str, seg_index: int, body: TranscriptSegmentEdit):
    with db.conn() as c:
        cur = c.execute(
            "UPDATE transcript_segments SET edited_text=? WHERE recording_id=? AND seg_index=?",
            (body.text.strip(), recording_id, seg_index),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "segment not found")
        row = c.execute(
            "SELECT seg_index, text, edited_text FROM transcript_segments WHERE recording_id=? AND seg_index=?",
            (recording_id, seg_index),
        ).fetchone()
        return {"seg": row["seg_index"], "text": row["text"], "edited_text": row["edited_text"]}


@router.post("/{recording_id}/reprocess")
def reprocess(recording_id: str):
    with db.conn() as c:
        row = c.execute("SELECT id FROM recordings WHERE id=?", (recording_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "recording not found")
        busy = c.execute(
            "SELECT id FROM jobs WHERE recording_id=? AND status IN ('queued','running')",
            (recording_id,),
        ).fetchone()
        if busy:
            raise HTTPException(409, "a job is already processing this recording")
        job_id = jobs.create_job(c, recording_id)
    jobs.dispatch(job_id, recording_id)
    return {"job_id": job_id}
