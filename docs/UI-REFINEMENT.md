# Takumi UI refinement

Implemented locally on 2026-10-08. Source of truth: [DESIGN.md](../DESIGN.md).

## What changed

- Replaced the dark green panel layout with a light electronics-workshop identity: vermilion seal, serif headings, ruled sections, numbered navigation, and restrained instrument styling.
- Capture now pairs an illustrative workshop photograph with a keyboard-accessible upload surface and a recording register. Uploads reject unsupported extensions and oversized files before sending; duplicate uploads are guarded.
- Review keeps the source transcript visible on desktop and collapses individual step editors. Transcript editing has an explicit keyboard-accessible control. Unsaved lesson edits block question/transcript operations that would replace them; navigation warns before discarding edits. Approval requirements remain enforced.
- Practice now includes a lesson library, labeled step progress, responsive oscilloscope, expert rationale, reset control, and a session receipt. Attempt submission has a duplicate-request guard and visible error state. Step transitions initialize instrument settings and feedback in one update.
- Idle recording requests run every 15 seconds rather than every second. Active jobs refresh every 1.5 seconds; hidden tabs skip polling. Canvas rendering stops when paused, locked, hidden, or reduced motion is requested, and its backing resolution is bounded to the displayed size and 2x device scale.
- Fixed backend test isolation: explicit saved-demo provider, hosted-provider credentials disabled in the fixture, and Whisper availability stubbed alongside transcription. No application provider configuration was changed.

## Verification

- `cd frontend; npm run build`: TypeScript and production build passed. Final production JavaScript is about 203 kB before gzip, 63 kB after gzip; CSS about 21 kB before gzip, 5.5 kB after gzip.
- `cd backend; .venv/Scripts/python.exe -m pytest tests -q`: 16 passed. One upstream Starlette/httpx deprecation warning.
- `scripts/verify-ui.cjs`: Playwright/Edge walkthrough passes for the static sample and real local backend on isolated sample data. Covers capture -> edit -> save -> resolve questions -> approve -> five practice steps -> stored attempt. Checks waveform pixels, moving and paused trace, and absence of uncaught browser errors.
- Horizontal overflow checks: capture at 360/390/768/1280/1440/1920 px; practice at 360/390/768/1280/1920 px; review and result at 390 px. Desktop/mobile screenshots inspected in `docs/screenshots/refined/` and `docs/screenshots/refined-local/`.
- To repeat with an installed Playwright: `node scripts/verify-ui.cjs`. Optional environment variables: `PLAYWRIGHT_MODULE` for the runtime module path, `BROWSER_CHANNEL` (default `msedge`), `BASE_URL` (default `http://127.0.0.1:5173`), and `OUTPUT_DIR`.
- The walkthrough needs a fresh sample lesson. It writes verification answers and an attempt, so use disposable browser state or an isolated `TAKUMI_DATA_DIR` for a real API run.

## Image asset

Built-in image generation produced the illustrative photograph, compressed to `frontend/public/images/workshop.webp` (1280 x 853, approximately 115 kB). It is labeled illustrative in the app and is not evidence of an actual expert recording.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: documentary photograph for an electronics apprenticeship application. Create a wide landscape 1536x1024 editorial photograph of a real electronics training workbench in Japan. Close overhead three-quarter view, a mature technician's hands in a dark navy work jacket carefully adjusting a gray benchtop oscilloscope with a clearly visible yellow sine wave on its display; another person's hand holds a probe near a small green circuit board on an antistatic charcoal mat. Gray metal workbench, a red probe lead, practical handwritten lab notebook partly visible. Authentic, quiet, tactile, candid craft photography with natural daylight and visible material texture. Restrained neutral colors, crisp actual equipment, no blurred or atmospheric background, no vignette, no dark filter, no logos, no overlaid text, no decorative graphics. Composition centered on instrument and hands, usable crop as a 3:2 or wide 2:1 horizontal image. This is a general illustrative image, not documentation of an actual project recording.

## Limits

The Vercel build uses the browser-based sample demo; recording uploads and AI processing require the local backend. Live Whisper transcription and hosted extraction were not verified in this pass; tests use stubs or the bundled synthetic lesson. The isolated Python environment has the API/test dependencies, not faster-whisper. Existing npm audit reports two development-tool findings in Vite 5/esbuild; upgrading the build toolchain is separate work. This UI pass does not certify physical bench competence.
