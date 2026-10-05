"""Structural + evidence-reference validation for extracted lesson drafts.

Strictness contract: malformed structure or out-of-range / non-matching evidence
references fail loudly (job failure / 422) instead of being silently stripped.
"""
from .extraction import quote_matches


def validate_extraction(result: dict, segments: list[dict]) -> list[str]:
    """Validate a raw extraction dict against the transcript. Returns error list."""
    errors: list[str] = []
    if not isinstance(result, dict):
        return ["extraction is not a JSON object"]

    title = result.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append("missing or empty 'title'")
    if not isinstance(result.get("summary", ""), str):
        errors.append("'summary' must be a string")

    steps = result.get("steps")
    if not isinstance(steps, list) or not steps:
        errors.append("'steps' must be a non-empty list")
        return errors

    for i, step in enumerate(steps):
        label = f"step[{i}]"
        if not isinstance(step, dict):
            errors.append(f"{label} is not an object")
            continue
        if not isinstance(step.get("title"), str) or not step["title"].strip():
            errors.append(f"{label}.title missing/empty")
        if not isinstance(step.get("instructions"), str) or not step["instructions"].strip():
            errors.append(f"{label}.instructions missing/empty")
        for field in ("rationale", "recovery"):
            if not isinstance(step.get(field), str):
                errors.append(f"{label}.{field} must be a string")
        for field in ("success_cues", "common_mistakes"):
            val = step.get(field, [])
            if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
                errors.append(f"{label}.{field} must be a list of strings")

        evidence = step.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{label}.evidence must be a non-empty list")
            continue
        for j, ev in enumerate(evidence):
            elabel = f"{label}.evidence[{j}]"
            if not isinstance(ev, dict) or not isinstance(ev.get("seg"), int):
                errors.append(f"{elabel} must be an object with integer 'seg'")
                continue
            seg = ev["seg"]
            if seg < 0 or seg >= len(segments):
                errors.append(f"{elabel}.seg={seg} is out of range (0..{len(segments) - 1})")
                continue
            quote = ev.get("quote")
            if not isinstance(quote, str) or not quote.strip():
                errors.append(f"{elabel}.quote missing/empty")
                continue
            seg_text = segments[seg].get("text", "")
            edited = segments[seg].get("edited_text")
            if not quote_matches(quote, seg_text, edited):
                errors.append(
                    f"{elabel}.quote does not match segment {seg} text: \"{str(quote)[:80]}\""
                )

    questions = result.get("questions", [])
    if questions and not isinstance(questions, list):
        errors.append("'questions' must be a list")
    else:
        for i, q in enumerate(questions):
            if not isinstance(q, dict) or not isinstance(q.get("question"), str) or not q["question"].strip():
                errors.append(f"questions[{i}] must be an object with non-empty 'question'")

    return errors


def validate_version_payload(title: str, steps: list[dict], segments: list[dict]) -> list[str]:
    """Validate an expert-edited draft version before save/approve."""
    errors: list[str] = []
    if not isinstance(title, str) or not title.strip():
        errors.append("title missing/empty")
    for i, step in enumerate(steps):
        label = f"step[{i}]"
        for j, ev in enumerate(step.get("evidence", [])):
            seg = ev.get("seg")
            if not isinstance(seg, int) or seg < 0 or seg >= len(segments):
                errors.append(f"{label}.evidence[{j}].seg={seg} is out of range (0..{len(segments) - 1})")
                continue
            seg_text = segments[seg].get("text", "")
            edited = segments[seg].get("edited_text")
            texts = (seg_text, edited) if edited else (seg_text,)
            if not quote_matches(ev.get("quote", ""), *texts):
                errors.append(
                    f"{label}.evidence[{j}].quote does not match segment {seg} text: "
                    f"\"{str(ev.get('quote', ''))[:80]}\""
                )
    return errors


def approval_blockers(questions: list[dict]) -> list[str]:
    blockers = []
    for q in questions:
        if q.get("status") not in ("answered", "dismissed"):
            blockers.append(f"question '{q.get('id')}' is unresolved")
        elif q.get("status") == "answered" and not (q.get("answer") or "").strip():
            blockers.append(f"question '{q.get('id')}' marked answered but has empty answer")
    return blockers
