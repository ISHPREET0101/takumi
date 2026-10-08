# Design

## Source of truth
Active, 2026-10-08. Capture, expert review, and guided practice. Evidence: README.md, frontend/src/pages, ScopeSimulator.tsx, existing CSS and docs/screenshots. Existing screenshots describe the superseded dark green interface.

## Brand
An electronics workshop and an expert's field notebook: precise, tactile, quietly confident. Vermilion identity, ink typography, light neutral surfaces. Avoid glowing dashboards, gradients, decorative metrics, oversized cards, and generic marketing composition.

## Product goals
Make recordings, evidence review, approval, and simulated practice easy to navigate. Preserve provenance and expert authority. Success: complete capture-to-review and approval-to-practice flows on desktop and mobile. Physical skill certification is out of scope.

## Personas and jobs
Experts verify their own recorded knowledge; apprentices practice decisions at a simulated bench. Primary context is a desktop electronics lab; mobile must remain usable.

## Information architecture
Persistent navigation: 01 Capture, 02 Expert review, 03 Practice. Capture has an upload surface and recording register. Review pairs source transcript with editable steps and follow-up questions. Practice has a lesson library, instrument, expert notes, and attempt receipt.

## Design principles
Use ruled sections and generous whitespace instead of containers inside containers. Keep operational information compact. Distinguish source evidence, expert decisions, and trainee actions. Status colors always accompany text.

## Visual language
White and cool off-white backgrounds, near-black text, vermilion primary actions, teal success, ochre warnings. Georgia headings, system sans-serif body, monospace indices and instrument labels. Spacing 4/8/12/16/24/32/48px. Radius 2-6px. No negative tracking. Lucide icons. Workshop image is generated illustration, never represented as recorded evidence. Oscilloscope retains a dark high-contrast display and yellow trace.

## Components
App owns navigation and connection state. Page heading and section-heading patterns live in styles.css. Existing buttons, inputs, notices, provenance badges, step editors, and transcript segments share CSS tokens. ScopeSimulator owns instrument rendering. Native details/summary controls collapse step editors.

## Accessibility
Target WCAG 2.2 AA. Visible focus, skip navigation, named inputs, native buttons and links, keyboard-operable upload and lesson selection. Reduced motion support; text equivalent for instrument state. Error messages and feedback announced with live regions.

## Responsive behavior
Desktop navigation rail; compact top navigation below 1000px. Capture is a full-width upload section without photography; practice columns collapse below 800px. Review transcript sticks on desktop and flows on mobile. Canvas scales to available width with a stable aspect ratio. Form grids collapse below 600px. Tables scroll within their own region.

## Interaction states
Explicit initial loading and empty library states. Upload guarded against duplicate requests with format and size validation. Poll active processing quickly, idle recordings every 15 seconds, suspend hidden-tab polling. Retry failed jobs with visible errors. Save and approval show busy/disabled states. Demo capture disabled with honest local-only explanation.

## Content voice
Short, direct lab language: recording, source, step, expert, evidence, practice. Keep actual limitations visible. Avoid implementation narration in primary flows; provenance detail belongs in badges and connection details.

## Implementation constraints
React 18, TypeScript, Vite, existing FastAPI API and static demo. Preserve API contracts and approval gating. Build/typecheck, existing backend regression suite, and browser walkthrough with desktop/mobile screenshots. Keep generated imagery local and compressed. Avoid new framework or component system.

## Open questions
- [ ] Owner: project team. Replace illustrative workshop photography with a consented photograph from the actual demonstration when available; no effect on functional verification.
