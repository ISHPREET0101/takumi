"""Takumi configuration. All knobs come from environment / backend/.env (git-ignored)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:  # pragma: no cover - dotenv is optional
    pass

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.getenv("TAKUMI_DATA_DIR", str(BASE_DIR / "data"))).resolve()
RECORDINGS_DIR = DATA_DIR / "recordings"
DB_PATH = DATA_DIR / "takumi.db"
FIXTURES_DIR = BASE_DIR / "fixtures"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

# --- Extraction providers -------------------------------------------------
# saved_demo  : bundled sample extraction, zero network, used for the offline demo
# ollama      : local model (qwen2.5:7b) via portable Ollama
# nvidia      : NVIDIA NIM hosted endpoint. Enable ONLY after confirming the
#               account's free entitlement; the flag below is intentionally
#               double-gated (key present AND explicitly enabled).
EXTRACTION_PROVIDER = os.getenv("TAKUMI_EXTRACTION_PROVIDER", "saved_demo").strip().lower()

NVIDIA_API_KEY = os.getenv("TAKUMI_NVIDIA_API_KEY", "").strip()
NVIDIA_ENABLED = os.getenv("TAKUMI_NVIDIA_ENABLED", "false").strip().lower() in ("1", "true", "yes")
NVIDIA_BASE_URL = os.getenv("TAKUMI_NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_MODEL = os.getenv("TAKUMI_NVIDIA_MODEL", "meta/llama-3.1-8b-instruct")

OLLAMA_BASE_URL = os.getenv("TAKUMI_OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("TAKUMI_OLLAMA_MODEL", "qwen2.5:7b")

# --- Transcription ---------------------------------------------------------
WHISPER_MODEL = os.getenv("TAKUMI_WHISPER_MODEL", "small.en")

# --- Limits ----------------------------------------------------------------
MAX_RECORDING_SECONDS = float(os.getenv("TAKUMI_MAX_RECORDING_SECONDS", "600"))
MAX_UPLOAD_MB = int(os.getenv("TAKUMI_MAX_UPLOAD_MB", "1000"))
LLM_TIMEOUT_SECONDS = float(os.getenv("TAKUMI_LLM_TIMEOUT_SECONDS", "60"))
LLM_MAX_ATTEMPTS = int(os.getenv("TAKUMI_LLM_MAX_ATTEMPTS", "2"))
LLM_MAX_TOKENS = int(os.getenv("TAKUMI_LLM_MAX_TOKENS", "3000"))

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".m4a", ".mp3", ".wav", ".ogg", ".flac"}


def ensure_dirs() -> None:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
