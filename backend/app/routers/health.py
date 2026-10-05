"""Health + provider readiness, so the UI can show what extraction will use."""
import httpx

from .. import config, db
from ..services import extraction as ex
from ..services import transcription as tr

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health():
    ollama_ok = ex.ollama_reachable(timeout=1.5)
    with db.conn() as c:
        demo = c.execute("SELECT id FROM recordings WHERE is_demo=1 LIMIT 1").fetchone()
    return {
        "status": "ok",
        "app": "Takumi",
        "whisper_available": tr.whisper_available(),
        "whisper_model": config.WHISPER_MODEL,
        "default_provider": config.EXTRACTION_PROVIDER,
        "providers": {
            "nvidia": {
                "enabled": config.NVIDIA_ENABLED,
                "key_present": bool(config.NVIDIA_API_KEY),
                "model": config.NVIDIA_MODEL,
                "base_url": config.NVIDIA_BASE_URL,
                "note": "enable only after confirming free entitlement",
            },
            "ollama": {
                "reachable": ollama_ok,
                "model": config.OLLAMA_MODEL,
                "base_url": config.OLLAMA_BASE_URL,
            },
            "saved_demo": {"available": demo is not None},
        },
    }
