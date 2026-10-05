"""Local transcription via faster-whisper (small.en, CPU INT8).

The model is lazy-loaded on first real transcription only, so importing this
module (and running tests) never triggers a multi-hundred-MB download.
"""
import json as _json
import shutil
import subprocess
import wave
from pathlib import Path

from .. import config

_model = None
_available: bool | None = None


def whisper_available() -> bool:
    global _available
    if _available is None:
        try:
            import faster_whisper  # noqa: F401
            _available = True
        except Exception:
            _available = False
    return _available


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


def media_duration(path: Path) -> float | None:
    """Best-effort duration probe. Exact for WAV; deferred to ffprobe/whisper for containers."""
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return None


def probe_duration_ffprobe(path: Path) -> float | None:
    """Container duration via ffprobe when available (mp4/mov/webm...).

    Lets oversized uploads fail in milliseconds instead of after the whisper
    model loads. Returns None when ffprobe is missing or the probe fails, in
    which case the whisper-reported duration is used later as before.
    """
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True,
            timeout=10,
        )
        if out.returncode != 0:
            return None
        return float(_json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return None


def media_duration_fast(path: Path) -> float | None:
    """WAV header first, ffprobe second, else None."""
    return media_duration(path) or probe_duration_ffprobe(path)


def transcribe(path: Path, on_progress=None) -> tuple[list[dict], float]:
    """Return (segments, duration). Segments: [{start, end, text}] with timestamps."""
    model = get_model()
    segments_iter, info = model.transcribe(
        str(path),
        language="en",
        beam_size=1,
        vad_filter=True,
    )
    out: list[dict] = []
    for seg in segments_iter:
        out.append(
            {
                "start": round(float(seg.start), 2),
                "end": round(float(seg.end), 2),
                "text": seg.text.strip(),
            }
        )
        if on_progress and info.duration:
            on_progress(min(1.0, seg.end / info.duration))
    return out, float(info.duration)
