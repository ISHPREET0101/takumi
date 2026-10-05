"""Extraction providers: NVIDIA NIM (hosted), Ollama (local), saved demo (offline).

Rules enforced here:
- Bounded requests: hard timeout, max 2 attempts, truncated error bodies.
- Caching: identical transcript + provider + model + prompt version reuses results.
- No automatic paid-provider switching: an explicitly requested provider that is
  unavailable fails loudly; only downward fallback (hosted -> local -> saved demo)
  is allowed, and only in 'auto' mode.
"""
import difflib
import hashlib
import json
import re
import threading
import time

import httpx

from .. import config, db
from .transcription import whisper_available  # noqa: F401  (re-export convenience)

PROMPT_VERSION = "v1"

SYSTEM_PROMPT = (
    "You are an expert instructional designer converting a master craftsperson's "
    "demonstration into a training lesson. You will receive a timestamped transcript "
    "segments list as JSON. Return STRICT JSON only (no markdown fences) matching:\n"
    '{"title": string, "summary": string, "steps": [{"id": string, "title": string, '
    '"instructions": string, "rationale": string, "success_cues": [string], '
    '"common_mistakes": [string], "recovery": string, '
    '"evidence": [{"seg": <0-based segment index>, "quote": "<verbatim text from that segment>"}]}], '
    '"questions": [{"question": string, "why_missing": string}]}\n'
    "Rules: every step needs at least one evidence item whose seg indexes the provided "
    "segments and whose quote is copied verbatim from that segment's text. "
    "Capture instructions, the expert's rationale, observable success cues, common "
    "mistakes they warn about, and recovery guidance. Where the expert's reasoning is "
    "implied but unstated, add an entry to questions instead of inventing an answer."
)


def build_user_prompt(segments: list[dict]) -> str:
    compact = [
        {"seg": i, "start": s["start"], "end": s["end"], "text": s["text"]}
        for i, s in enumerate(segments)
    ]
    return (
        "Transcript segments (0-based indexing):\n"
        + json.dumps(compact, ensure_ascii=False)
        + "\n\nExtract the lesson JSON now."
    )


class ProviderError(Exception):
    """Provider was reachable but the request/parse failed."""


class ProviderUnavailable(Exception):
    """Provider is not configured / not reachable. No silent switching."""


def parse_model_json(raw: str) -> dict:
    """Tolerant JSON extraction from a chat-completion response body."""
    if isinstance(raw, dict):
        return raw
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        snippet = text[:120].replace("\n", " ")
        raise ProviderError(f"model response contained no JSON object (starts with: {snippet!r})")
    try:
        return json.loads(text[start : end + 1])
    except ValueError as exc:
        raise ProviderError(f"model response was not valid JSON: {exc}") from exc


def _post_json(url: str, headers: dict, payload: dict, trust_env: bool = True) -> dict:
    last_err: Exception | None = None
    for attempt in range(max(1, config.LLM_MAX_ATTEMPTS)):
        try:
            resp = httpx.post(
                url, headers=headers, json=payload,
                timeout=config.LLM_TIMEOUT_SECONDS, trust_env=trust_env,
            )
            if resp.status_code >= 400:
                body = resp.text[:300]
                raise ProviderError(f"HTTP {resp.status_code} from provider: {body}")
            return resp.json()
        except (httpx.NetworkError, httpx.TimeoutException) as exc:
            last_err = exc
            if attempt < config.LLM_MAX_ATTEMPTS - 1:
                time.sleep(2)
        except ProviderError as exc:
            # 4xx/5xx: retry once on 5xx only, fail fast on 4xx
            msg = str(exc)
            if msg.startswith("HTTP 5") and attempt < config.LLM_MAX_ATTEMPTS - 1:
                last_err = exc
                time.sleep(2)
            else:
                raise
    raise ProviderError(f"provider unreachable after retries: {last_err}")


# --- NVIDIA NIM (OpenAI-compatible) ----------------------------------------


def nvidia_ready() -> bool:
    return bool(config.NVIDIA_ENABLED and config.NVIDIA_API_KEY)


def extract_with_nvidia(segments: list[dict]) -> dict:
    if not nvidia_ready():
        raise ProviderUnavailable(
            "NVIDIA NIM not enabled. Confirm the account's free entitlement, then set "
            "TAKUMI_NVIDIA_API_KEY and TAKUMI_NVIDIA_ENABLED=true (docs: "
            "https://docs.api.nvidia.com/nim/docs/product)."
        )
    url = f"{config.NVIDIA_BASE_URL}/chat/completions"
    payload = {
        "model": config.NVIDIA_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(segments)},
        ],
        "temperature": 0.2,
        "max_tokens": config.LLM_MAX_TOKENS,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {config.NVIDIA_API_KEY}",
        "Accept": "application/json",
    }
    data = _post_json(url, headers, payload)
    try:
        raw = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError(f"unexpected NVIDIA response shape: {str(data)[:300]}") from exc
    return parse_model_json(raw)


# --- Ollama (local) ---------------------------------------------------------

# Reachability probe is cached and refreshed in the background: on some Windows
# setups a refused localhost connect costs seconds, and the UI health chip polls
# often. ok=None means "never probed yet"; UI treats it as unknown/checking.
_ollama_probe = {"ts": 0.0, "ok": None}
OLLAMA_PROBE_TTL_SECONDS = 15.0


def _ollama_probe_now(timeout: float) -> None:
    ok = False
    try:
        # trust_env=False: never route a localhost probe through a system proxy.
        r = httpx.get(f"{config.OLLAMA_BASE_URL}/api/tags", timeout=timeout, trust_env=False)
        ok = r.status_code == 200
    except Exception:
        ok = False
    _ollama_probe["ts"] = time.time()
    _ollama_probe["ok"] = ok


def ollama_reachable(timeout: float = 1.0, force: bool = False) -> bool | None:
    """Cached reachability verdict: True / False / None (unknown yet).

    Non-blocking by default — when the cache is stale, a daemon thread refreshes
    it and the last known value is returned immediately. Pass force=True for a
    synchronous, authoritative probe (extraction path only).
    """
    fresh = time.time() - _ollama_probe["ts"] < OLLAMA_PROBE_TTL_SECONDS
    if not fresh:
        if force:
            _ollama_probe_now(timeout)
        else:
            threading.Thread(target=_ollama_probe_now, args=(timeout,), daemon=True).start()
    return _ollama_probe["ok"]


def extract_with_ollama(segments: list[dict]) -> dict:
    # Authoritative (synchronous) probe: extraction is a deliberate user action,
    # so a one-off connect cost is acceptable here for a precise error message.
    if ollama_reachable(timeout=1.0, force=True) is not True:
        raise ProviderUnavailable(
            f"Ollama not reachable at {config.OLLAMA_BASE_URL}. Start portable Ollama "
            f"and pull {config.OLLAMA_MODEL} (https://ollama.com/library/qwen2.5:7b)."
        )
    payload = {
        "model": config.OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.2, "num_predict": config.LLM_MAX_TOKENS},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(segments)},
        ],
    }
    data = _post_json(f"{config.OLLAMA_BASE_URL}/api/chat", {}, payload, trust_env=False)
    raw = data.get("message", {}).get("content", "")
    if not raw:
        raise ProviderError(f"empty Ollama response: {str(data)[:300]}")
    return parse_model_json(raw)


# --- Saved demonstration (offline) ------------------------------------------


def extract_with_saved_demo(segments: list[dict], bundle_path: str) -> dict:
    try:
        with open(bundle_path, "r", encoding="utf-8") as f:
            bundle = json.load(f)
    except (OSError, ValueError) as exc:
        raise ProviderError(f"saved demo bundle unreadable: {exc}") from exc
    bundled = bundle.get("extraction")
    if not bundled:
        raise ProviderError("saved demo bundle has no extraction payload")
    # The demo extraction was authored against the bundled transcript; if the
    # expert edited the transcript we still validate evidence against BOTH the
    # original bundled text and the edited text, which validation.py handles.
    return bundled


# --- Resolution + caching ----------------------------------------------------

PROVIDERS = {
    "nvidia": ("hosted_ai", lambda segments, ctx: extract_with_nvidia(segments), lambda: config.NVIDIA_MODEL),
    "ollama": ("local_ai", lambda segments, ctx: extract_with_ollama(segments), lambda: config.OLLAMA_MODEL),
}


def provenance_for(provider: str) -> str:
    if provider == "nvidia":
        return "hosted_ai"
    if provider == "ollama":
        return "local_ai"
    return "saved_demo"


def cache_key_for(segments: list[dict], provider: str, model: str) -> str:
    basis = json.dumps(
        {"v": PROMPT_VERSION, "p": provider, "m": model, "s": segments},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def cached_result(c, key: str) -> dict | None:
    row = c.execute(
        "SELECT result_json, provider, model FROM extraction_cache WHERE cache_key=?", (key,)
    ).fetchone()
    if not row:
        return None
    return json.loads(row["result_json"])


def store_cache(c, key: str, result: dict, provider: str, model: str) -> None:
    c.execute(
        "INSERT OR REPLACE INTO extraction_cache(cache_key, result_json, provider, model, created_at) "
        "VALUES(?,?,?,?,?)",
        (key, json.dumps(result, ensure_ascii=False), provider, model, db.now_iso()),
    )


def extract_with_cache(c, provider: str, segments: list[dict], ctx: dict) -> tuple[dict, str, str, bool]:
    """Returns (result, provider, model, was_cached). ctx needs demo_bundle for saved_demo."""
    if provider == "saved_demo":
        model = "bundled-sample"
        result = extract_with_saved_demo(segments, ctx["demo_bundle"])
        return result, provider, model, False

    if provider not in PROVIDERS:
        raise ProviderUnavailable(f"unknown provider '{provider}'")
    model = PROVIDERS[provider][2]()

    key = cache_key_for(segments, provider, model)
    hit = cached_result(c, key)
    if hit is not None:
        return hit, provider, model, True

    result = PROVIDERS[provider][1](segments, ctx)
    store_cache(c, key, result, provider, model)
    return result, provider, model, False


def resolve_provider(requested: str, is_demo: bool) -> list[str]:
    """Return the ordered candidate list. Explicit requests never silently switch
    to a paid provider; auto mode walks hosted -> local -> saved demo."""
    requested = (requested or "auto").lower()
    if requested == "nvidia":
        return ["nvidia"]
    if requested == "ollama":
        return ["ollama"]
    if requested == "saved_demo":
        if not is_demo:
            raise ProviderUnavailable("saved_demo extraction is only available for the bundled sample recording")
        return ["saved_demo"]
    # auto
    chain = []
    if nvidia_ready():
        chain.append("nvidia")
    chain.append("ollama")
    if is_demo:
        chain.append("saved_demo")
    return chain


# --- Quote matching (shared with validation) ---------------------------------


def normalize(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_matches(quote: str, *segment_texts: str) -> bool:
    a = normalize(quote)
    if not a:
        return False
    for text in segment_texts:
        b = normalize(text or "")
        if not b:
            continue
        if a in b or b in a:
            return True
        if difflib.SequenceMatcher(None, a, b).ratio() >= 0.6:
            return True
    return False
