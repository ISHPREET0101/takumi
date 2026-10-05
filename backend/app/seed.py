"""First-run seeding: create the bundled sample demonstration so the whole
capture -> review -> practice workflow is usable offline, immediately.

The sample media is a clearly-labelled synthetic WAV (no real person recorded).
Real expert recordings are uploaded through the Capture page like any other file.
"""
import array
import math
import random
import uuid
import wave

from . import config, db, jobs

SAMPLE_SECONDS = 214
SAMPLE_RATE = 8000


def _generate_wav(path) -> None:
    """Amplitude-modulated tone bursts: sounds like muffled workshop audio.

    The 165/330/495 Hz tone tiles exactly every 0.6 s (99/198/297 cycles), so it
    is precomputed once as a wavetable instead of 3 sine calls per sample —
    first-boot seeding drops from ~6 s to ~2 s on CPython.
    """
    rng = random.Random(42)
    two_pi = 2.0 * math.pi
    total = SAMPLE_RATE * SAMPLE_SECONDS
    tone_len = int(SAMPLE_RATE * 0.6)
    tone = [
        math.sin(two_pi * 165.0 * n / SAMPLE_RATE)
        + 0.5 * math.sin(two_pi * 330.0 * n / SAMPLE_RATE + 0.7)
        + 0.25 * math.sin(two_pi * 495.0 * n / SAMPLE_RATE + 1.3)
        for n in range(tone_len)
    ]
    noise = [rng.uniform(-1.0, 1.0) for _ in range(total)]

    samples = array.array("h", bytes(2 * total))
    for n in range(total):
        t = n / SAMPLE_RATE
        # speech-like cadence: 3 Hz syllable envelope + slow utterance envelope
        syllable = 0.55 + 0.45 * math.sin(two_pi * 3.1 * t)
        utterance = 0.5 + 0.5 * math.sin(two_pi * 0.28 * t + 1.0)
        gate = 1.0 if (math.sin(two_pi * 0.09 * t) > -0.35) else 0.15
        amp = 0.22 * syllable * utterance * gate
        v = amp * tone[n % tone_len] + noise[n] * 0.05 * gate
        samples[n] = int(max(-1.0, min(1.0, v)) * 32767)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(samples.tobytes())


def seed_if_needed() -> None:
    config.ensure_dirs()
    with db.conn() as c:
        if db.get_meta(c, "seed_v1") == "done":
            return
        recording_id = str(uuid.uuid4())
        wav_path = config.RECORDINGS_DIR / "sample_oscilloscope_demo.wav"
        if not wav_path.exists():
            _generate_wav(wav_path)
        c.execute(
            "INSERT OR REPLACE INTO recordings(id, original_name, stored_path, media_kind, "
            "size_bytes, duration_sec, is_demo, demo_bundle, sha256, created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                recording_id,
                "sample_oscilloscope_demo.wav (bundled synthetic sample)",
                str(wav_path),
                "audio",
                wav_path.stat().st_size,
                float(SAMPLE_SECONDS),
                1,
                str(config.FIXTURES_DIR / "sample_oscilloscope_demo.json"),
                "bundled-sample",
                db.now_iso(),
            ),
        )
        job_id = jobs.create_job(c, recording_id)
        db.set_meta(c, "seed_v1", "done")
    jobs.dispatch(job_id, recording_id)
