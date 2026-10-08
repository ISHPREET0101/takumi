# Takumi — Verification report

Date: 2026-10-05 (optimized build) · Environment: Windows 11, Python 3.13.1, Node 24.11.1, ffmpeg 9.0, LibreOffice 26.8

## Automated (pytest — 16/16 passed, `cd backend && python -m pytest tests/ -q`)

| # | Verification item (from plan) | Result |
|---|---|---|
| 1 | Seed creates the bundled sample and the full saved-demo pipeline produces a draft lesson | ✅ `test_seed_creates_demo_and_processes` |
| 2 | Unapproved lessons are invisible to trainees (403); visible only after approval | ✅ `test_trainee_cannot_see_unapproved_then_can_after_approval` |
| 3 | Approval blocked while any follow-up question is unresolved | ✅ same test (422 with blocker list) |
| 4 | Out-of-range evidence references rejected | ✅ `test_invalid_evidence_reference_rejected` |
| 5 | Non-matching evidence quotes rejected | ✅ same test |
| 6 | Attempts stored tied to the exact approved lesson version | ✅ `test_attempt_stored_and_tied_to_approved_version` |
| 7 | Attempts referencing steps outside the approved version rejected (422) | ✅ same test |
| 8 | Score recomputed server-side from per-step results (tamper-proof) | ✅ `test_attempt_score_recomputed_server_side` (35 expected / 35 got) |
| 9 | Persistence after restart + orphaned jobs marked "interrupted" on startup | ✅ `test_persistence_and_interrupted_jobs_marked_failed` |
| 10 | Malformed provider response (well-formed HTTP, non-JSON content) fails loudly, no fallback | ✅ `test_malformed_provider_response_fails_loudly` |
| 11 | Structurally invalid model output rejected by validation (seg out of range) | ✅ `test_validation_rejects_bad_model_output` |
| 12 | Local-AI (Ollama) pipeline end-to-end: provenance `local_ai`, provider/model recorded, extraction cache hit on identical rerun | ✅ `test_full_local_ai_pipeline_creates_lesson_with_provenance` |
| 13 | Explicit provider request never silently switches (nvidia unavailable → loud failure, no ollama/saved_demo attempt) | ✅ `test_explicit_provider_never_silently_switches` |
| 14 | `auto` mode falls downward only (hosted→local→saved demo), non-demo fails with guidance when nothing available | ✅ `test_auto_mode_falls_downward_only` |
| 15 | Transcript edits keep evidence quotes valid against original text | ✅ `test_transcript_edit_keeps_original_quotes_valid` |
| 16 | `/api/health` reports provider readiness + NVIDIA "confirm free entitlement" note | ✅ `test_health_reports_provider_state` |
| 17 | Media streaming supports HTTP Range → 206 partial content (video seeking) | ✅ `test_media_range_request_supported` |
| 18 | Oversized recordings rejected in the probe stage, before whisper loads | ✅ `test_oversized_recording_fails_fast_before_transcription` |
| 19 | Ollama reachability probe is TTL-cached — repeated health calls don't re-probe | ✅ `test_health_ollama_probe_is_cached` |

## Performance optimizations (measured, 2026-10-05)

| Area | Before | After | How |
|---|---|---|---|
| `/api/health` latency | 3.6 s per call (Ollama probe waited on a slow-to-refuse localhost port) | **~6 ms** every call | Non-blocking probe: background refresh + TTL cache; `trust_env=False` so system proxies never intercept localhost; extraction uses a synchronous forced probe only when actually extracting |
| Oversized upload rejection | after whisper model load | **milliseconds** | ffprobe (`media_duration_fast`) duration pre-check before any model work |
| First-boot seeding (214 s synthetic WAV) | ~6 s | **1.95 s** | 165/330/495 Hz tone precomputed as a 0.6 s wavetable (tiles exactly at 99/198/297 cycles) + `array('h')` batch write |
| API payloads | uncompressed | **gzip** for responses > 500 B | `GZipMiddleware` |
| DB hot paths | full scans | indexed | `jobs(recording_id)`, `lessons(recording_id)`, `lesson_versions(lesson_id)`, `attempts(lesson_id)` |
| Video seeking in Review | — | verified 206 + `Content-Range` | Starlette FileResponse range support (test #17) |

## Recording limits raised to 10 min / 1 GB (2026-10-05)

- `TAKUMI_MAX_RECORDING_SECONDS` default **300 → 600**, `TAKUMI_MAX_UPLOAD_MB` **300 → 1 GB** (a real 10-minute 1080p video needs more than 300 MB). Updated everywhere: config, `.env.example`, Capture-page wording, README, pitch deck (regenerated pptx + pdf), and the oversized-rejection test (700 s probe vs 600 s limit).
- **Live end-to-end proof (real video):** the user's actual 315 s (5:15) upload — previously rejected by the old 300 s limit — reprocessed successfully: passed the duration gate, decoded via PyAV, transcribed by real faster-whisper `small.en` into **65 speech segments**. It then stops at the extraction stage with clear guidance because no AI provider is configured yet (default is the offline `saved_demo` path; NVIDIA/Ollama remain gated by the plan's pending confirmations).
- **Dependency bug found & fixed by the live test:** faster-whisper 1.2.1 passes `metadata_errors=` to `av.open()`, which PyAV 19 removed → real transcription crashed with `TypeError`. Pinned `av>=14,<19` in `requirements.txt` (verified on av 18.1.0) and added a friendly failure message for undecodable audio files (`transcription failed — audio could not be decoded (corrupt or unsupported file)`).

## Live hosted-AI extraction (2026-10-05) — NVIDIA NIM ✅

The pending "NVIDIA NIM live" item is now **done**, using the model chosen on build.nvidia.com:

- **Model:** `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (262K context, reasoning; free NIM credits confirmed by the working call).
- **Result:** the real 315 s video (65 whisper-transcribed speech segments) extracted into a **5-step draft lesson with 4 flagged follow-up questions**, every step evidence-linked to verbatim transcript segments; provenance badge switched to **Hosted AI**.
- **Reasoning-model tuning (in git-ignored `.env`):** `TAKUMI_LLM_MAX_TOKENS=8000` and `TAKUMI_LLM_TIMEOUT_SECONDS=240` — the reasoning pass needs more thinking tokens and wall time than the 60 s default (first attempt read-timed-out at 60 s, succeeded at 240 s).
- **What the draft shows by design:** AI transcription of real speech contains mis-hearings (e.g. "bat-masked motion"), and the model flags implied-but-unstated reasoning as questions instead of inventing answers — both are resolved by the human expert in the Review stage, which is the product's core claim.

## Frontend robustness additions

- React `ErrorBoundary` around all pages — a page crash shows a recoverable banner instead of a white screen.
- Review page: loading state, and **"Copy as text"** export of the whole lesson (for PDFs/handouts).
- Practice completion screen: **all attempts on the lesson** (per trainee history) after submitting.
- Recording list re-render stabilized (polling no longer replaces DOM nodes mid-interaction).

## Browser verification (live app at http://127.0.0.1:8000, Chromium 1440×900)

- ✅ Capture page: seeded sample listed, job `succeeded`, provenance badge "Saved demonstration · saved_demo/bundled-sample", 15 transcript segments.
- ✅ Review page: transcript with timestamped segments (click-to-play wired to media element), editable lesson draft, evidence chips with validity flags, 3 follow-up questions.
- ✅ Approval gating in UI: "Approve version" disabled with `0 evidence issue(s), 3 unresolved question(s)`; enabled after answering all three via the answer boxes.
- ✅ After approval: version selector shows `v1 · approved`; Practice list shows exactly this lesson.
- ✅ Practice: 5-step guided run — free step, vertical scale (wrong check → expert mistake feedback; correct → rationale feedback), timebase, trigger lock, and the recovery scenario (disturbance drops the trigger; restoring it shows "TRIGGERED — LOCKED" with the 0.40 V line on the rising slope).
- ✅ Session complete: score 95/100 (one wrong adjustment correctly cost 25% of one step), attempt stored with id `3b31fc33…`, tied to approved version v1.
- ✅ Instructor Review page shows the attempt in "Practice attempts (1)".
- ✅ Health chip: `provider: saved_demo · whisper small.en ready`.
- ✅ Post-optimization re-verification: Review renders with new "Copy as text" button and attempt history intact; Practice flow runs on the rebuilt bundle; header health instant.

## Round-1 deck verification

- ✅ `docs/Takumi_Round1_JETRO-PS-03.pptx` (6 pages) generated from `scripts/make_deck.js`; editable PowerPoint.
- ✅ Exported `docs/Takumi_Round1_JETRO-PS-03.pdf` via LibreOffice for submission.
- ✅ Programmatic QA: no off-slide shapes, no text overflow (python-pptx bounding/estimate pass, 0 issues).
- ✅ Visual QA: all 6 rendered slides inspected — no clipping, overlaps, contrast or image-distortion defects (screenshots embedded at native 1440×900 aspect).
- ⚠️ Team name and member names are `[PLACEHOLDER]` on slide 1 — fill before submission.

## Manual / pending (requires physical setup or credentials — from plan)

| Item | Status | How to run |
|---|---|---|
| Real consented expert recording through the full whisper path | ⏳ pending (deliverable 1) | Upload via Capture page; whisper `small.en` INT8 installed and lazy-loads on first use |
| NVIDIA NIM hosted extraction with real key | ⏳ blocked on free-entitlement confirmation | Set `TAKUMI_NVIDIA_API_KEY` + `TAKUMI_NVIDIA_ENABLED=true` in `backend/.env`, set provider `nvidia` |
| Ollama `qwen2.5:7b` processing-time benchmark | ⏳ pending (benchmarks before any speed claims) | Start portable Ollama, pull model, upload real recording, time the job stages |
| Full offline demonstration (no internet) | ✅ verified this session: app served from `frontend/dist` by the backend, saved_demo extraction, no network calls | `python run.py` → http://127.0.0.1:8000 |
| Effectiveness comparison vs conventional instructions (trainee time/mistakes) | ⏳ pending — disclose sample size; no effectiveness claims until measured | Recruit ≥2 trainees, run lesson vs. written instructions, compare attempt metrics |
| Simulator scoring vs expert-approved correct/incorrect/recovery scenarios | ✅ partially automated (server-side scoring integrity) + browser walkthrough of all three scenario types | — |
| API throttling / exhausted free access behaviour | ✅ covered by bounded-retry + loud-failure tests (mocked); live 429 path to re-check once NVIDIA key is confirmed | — |

## Recording limit raised to 30 minutes (2026-10-08)

- Current default: `TAKUMI_MAX_RECORDING_SECONDS=1800` (30 minutes); the upload size cap remains 1000 MB. Updated backend defaults, environment example, capture text, README, and deck source. Previously generated deck files retain their historical limits until regenerated.
- Regression coverage uploads an MP4 with stubbed metadata/transcription at exactly 1800 seconds and rejects 1801 seconds. Both the early probe and transcription-duration fallback paths are covered. These tests verify validation, not real 30-minute video decoding or model processing performance.
- Existing installations with an explicit duration override should set it to `1800` and restart the backend. Vercel remains the sample-only frontend; actual uploads require the local backend and transcription dependencies.

## Known limitations

- Reprocessing a recording creates a **new** draft lesson (previous lessons remain). Intentional for review history; merge later if needed.
- Evidence-quote matching accepts fuzzy similarity ≥ 0.6 (normalized) to tolerate transcription fixes — the threshold is deliberately conservative and every invalid reference still fails loudly.
- The bundled sample audio is synthetic (tone-based); it is clearly labelled in the UI and must be replaced by the real expert recording for Round 1.
