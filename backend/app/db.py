"""SQLite access layer. Plain sqlite3, WAL mode, JSON stored as TEXT."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'video',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  demo_bundle TEXT,
  sha256 TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- queued | running | succeeded | failed
  stage TEXT,                       -- uploading | transcribing | extracting | validating | finalizing | done
  progress REAL NOT NULL DEFAULT 0, -- 0..100
  error TEXT,
  provider TEXT,
  model TEXT,
  lesson_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL,
  seg_index INTEGER NOT NULL,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  text TEXT NOT NULL,
  edited_text TEXT,
  UNIQUE(recording_id, seg_index)
);

CREATE TABLE IF NOT EXISTS extraction_cache (
  cache_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  recording_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  current_version_id TEXT,
  approved_version_id TEXT
);

CREATE TABLE IF NOT EXISTS lesson_versions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  status TEXT NOT NULL,             -- draft | approved
  provenance TEXT NOT NULL,         -- hosted_ai | local_ai | saved_demo
  provider TEXT,
  model TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  changelog TEXT,
  UNIQUE(lesson_id, version_number)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  lesson_version_id TEXT NOT NULL,
  trainee_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  duration_ms INTEGER,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_recording ON jobs(recording_id);
CREATE INDEX IF NOT EXISTS idx_lessons_recording ON lessons(recording_id);
CREATE INDEX IF NOT EXISTS idx_versions_lesson ON lesson_versions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_attempts_lesson ON attempts(lesson_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def conn() -> sqlite3.Connection:
    config.ensure_dirs()
    c = sqlite3.connect(str(config.DB_PATH), timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


def get_meta(c: sqlite3.Connection, key: str) -> str | None:
    row = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(c: sqlite3.Connection, key: str, value: str) -> None:
    c.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def load_json(text: str, default):
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
