/* Takumi — Round 1 deck (6 pages), Thapar Japan Hackathon 2026
 * Palette: instrument dark + scope-trace green + trigger amber accent.
 * Motif: oscilloscope graticule + monospace readout chips.
 */
const pptxgen = require("pptxgenjs");

const BG = "0E1512";        // deep instrument dark (dominant)
const PANEL = "16241F";     // card tint
const PANEL2 = "1B2E26";    // slightly lighter panel
const PRIMARY = "4ADE80";   // scope-trace green
const PRIMARY_DIM = "2C6E46";
const ACCENT = "FBBF24";    // trigger amber (sparing)
const TEXT = "E6EFE9";
const MUTED = "8AA39A";
const HAIR = "23392F";

const W = 13.33, H = 7.5, M = 0.5;
const F = "Segoe UI";
const FM = "Consolas";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Takumi Team";
pres.title = "Takumi — JETRO-PS-03 — Thapar Japan Hackathon 2026";

// --- helpers -------------------------------------------------------------
const graticule = (slide) => {
  // faint scope graticule: 10x4 verticals, 6 horizontals, hairline
  for (let i = 1; i < 10; i++) {
    slide.addShape(pres.shapes.LINE, { x: (W / 10) * i, y: 0, w: 0, h: H, line: { color: HAIR, width: 0.5 } });
  }
  for (let j = 1; j < 6; j++) {
    slide.addShape(pres.shapes.LINE, { x: 0, y: (H / 6) * j, w: W, h: 0, line: { color: HAIR, width: 0.5 } });
  }
};

const chip = (slide, x, y, text, color = PRIMARY) => {
  slide.addText(text, {
    x, y, w: 7.0, h: 0.32, fontFace: FM, fontSize: 11, color, align: "left",
    margin: 0, charSpacing: 2,
  });
};

const card = (slide, x, y, w, h, fill = PANEL) => {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: fill }, rectRadius: 0.08,
    line: { color: HAIR, width: 0.75 },
  });
};

// ========================================================================
// SLIDE 1 — Title
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };
  graticule(s);

  // scope trace motif: a sine-ish polyline across the lower third
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = i * (W / 40);
    const y = 5.55 - Math.sin((i / 40) * Math.PI * 4) * 0.55;
    pts.push({ x, y });
  }
  for (let i = 0; i < pts.length - 1; i++) {
    s.addShape(pres.shapes.LINE, {
      x: pts[i].x, y: pts[i].y, w: pts[i + 1].x - pts[i].x, h: pts[i + 1].y - pts[i].y,
      line: { color: PRIMARY, width: 2.25 },
    });
  }
  // trigger line
  s.addShape(pres.shapes.LINE, { x: 0, y: 5.55, w: W, h: 0, line: { color: ACCENT, width: 1.25, dashType: "dash" } });
  s.addText("trigger 0.40 V (rise) — TRIGGERED · LOCKED", {
    x: M, y: 5.62, w: 5.5, h: 0.3, fontFace: FM, fontSize: 11, color: ACCENT, margin: 0,
  });

  s.addText("匠", { x: M, y: 0.62, w: 1.15, h: 1.15, fontFace: F, fontSize: 60, bold: true, color: BG, align: "center", fill: { color: PRIMARY }, margin: 0 });
  s.addText("TAKUMI", { x: 1.95, y: 0.72, w: 7.5, h: 0.75, fontFace: F, fontSize: 47, bold: true, color: TEXT, margin: 0, charSpacing: 4 });
  s.addText("Expert knowledge, captured. Craftsmanship, inherited.", {
    x: 1.95, y: 1.5, w: 9.5, h: 0.45, fontFace: F, fontSize: 18, color: MUTED, margin: 0,
  });

  s.addText([
    { text: "Preserving & Transferring Tacit Technical Expertise to Future Generations", options: { fontSize: 20, color: TEXT, bold: true, breakLine: true } },
    { text: "JETRO-PS-03 · Thapar Japan Hackathon 2026 — Bridging Tradition and Innovation", options: { fontSize: 13, color: PRIMARY, breakLine: true } },
    { text: "Team [NAME]  ·  [Member 1] · [Member 2] · [Member 3] · [Member 4]", options: { fontSize: 12, color: MUTED } },
  ], { x: M, y: 2.55, w: 10.8, h: 2.2, fontFace: F, margin: 0, paraSpaceAfter: 8 });

  chip(s, M, 6.35, "CAPTURE ▸ EXTRACT ▸ REVIEW ▸ APPROVE ▸ PRACTICE", PRIMARY);
  chip(s, M, 6.75, "OFFLINE-CAPABLE · RECORDINGS STAY LOCAL · ZERO PAID API", MUTED);
}

// ========================================================================
// SLIDE 2 — The problem (expert evidence)
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };
  graticule(s);

  s.addText("The knowledge leaves before it is written down", {
    x: M, y: 0.5, w: 11.5, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: TEXT, margin: 0,
  });
  s.addText("Japan's master technicians are retiring faster than apprenticeships can replace them. What they know lives in hands and judgement — not manuals. A retiring expert takes decades of micro-decisions with them.", {
    x: M, y: 1.25, w: 11.9, h: 0.85, fontFace: F, fontSize: 15, color: MUTED, margin: 0,
  });

  s.addText("What a single 3-minute demonstration actually contains", {
    x: M, y: 2.45, w: 7.0, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: PRIMARY, margin: 0,
  });
  const rows = [
    ["Rules never written", "\u201CConnect the ground clip first — tip-first can float and damage the front end.\u201D"],
    ["The math behind the feel", "\u201C500 mV/div — 2 V needs 4 of 8 divisions, leaving headroom for overshoot.\u201D"],
    ["Rules of thumb", "\u201CTwo cycles on screen — enough to judge period and symmetry.\u201D"],
    ["Failure diagnosis", "\u201CPark the level on the noisy flat top and the display jitters all day.\u201D"],
    ["Recovery moves", "\u201CEnable trigger, walk the level to a clean rising crossing, stop.\u201D"],
  ];
  rows.forEach(([h, q], i) => {
    const y = 2.95 + i * 0.78;
    s.addShape(pres.shapes.OVAL, { x: M, y: y + 0.07, w: 0.14, h: 0.14, fill: { color: PRIMARY } });
    s.addText([
      { text: h + "  ", options: { bold: true, color: TEXT, fontSize: 14.5 } },
      { text: q, options: { color: MUTED, fontSize: 13, italic: true } },
    ], { x: M + 0.3, y, w: 7.0, h: 0.75, fontFace: F, margin: 0 });
  });

  card(s, 8.15, 2.45, 4.68, 4.4);
  s.addText("WHY VIDEO ALONE FAILS", { x: 8.45, y: 2.75, w: 4.1, h: 0.35, fontFace: FM, fontSize: 12, color: ACCENT, margin: 0, charSpacing: 1 });
  s.addText([
    { text: "Unstructured — a 5-minute video holds ~40 micro-decisions nobody can search", options: { bullet: { code: "2013", indent: 12 }, breakLine: true, color: TEXT } },
    { text: "Unverified — transcripts mis-hear; no link from claim to evidence", options: { bullet: { code: "2013", indent: 12 }, breakLine: true, color: TEXT } },
    { text: "Untested — watching is not doing; nothing checks the trainee", options: { bullet: { code: "2013", indent: 12 }, breakLine: true, color: TEXT } },
    { text: "Unowned — the expert never confirms what AI inferred", options: { bullet: { code: "2013", indent: 12 }, color: TEXT } },
  ], { x: 8.45, y: 3.2, w: 4.15, h: 2.9, fontFace: F, fontSize: 13.5, margin: 0, paraSpaceAfter: 12 });
  s.addText("Evidence: bundled expert demonstration on oscilloscope setup & signal troubleshooting (5 steps extracted, 3 gaps flagged for the expert).", {
    x: 8.45, y: 6.15, w: 4.15, h: 0.6, fontFace: F, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });
}

// ========================================================================
// SLIDE 3 — Product workflow + live screenshot
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };

  s.addText("One video becomes a lesson a trainee can practice", {
    x: M, y: 0.5, w: 12.3, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: TEXT, margin: 0,
  });

  const steps = [
    ["1", "CAPTURE", "≤5-min demo video; stays on-device"],
    ["2", "EXTRACT", "local transcription + AI draft with evidence links"],
    ["3", "REVIEW", "expert corrects, answers gaps, sees provenance"],
    ["4", "APPROVE", "only approved versions reach trainees"],
    ["5", "PRACTICE", "simulator scores decisions, cites the expert"],
  ];
  const bw = 2.32, gap = 0.22;
  steps.forEach(([n, t, d], i) => {
    const x = M + i * (bw + gap);
    card(s, x, 1.35, bw, 1.55, i === 4 ? PANEL2 : PANEL);
    s.addText(n, { x: x + 0.16, y: 1.5, w: 0.8, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: PRIMARY, margin: 0 });
    s.addText(t, { x: x + 0.16, y: 2.12, w: bw - 0.3, h: 0.3, fontFace: FM, fontSize: 12.5, color: TEXT, margin: 0, charSpacing: 1.5 });
    s.addText(d, { x: x + 0.16, y: 2.42, w: bw - 0.3, h: 0.45, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });
    if (i < 4) {
      s.addText("▸", { x: x + bw - 0.06, y: 1.9, w: 0.35, h: 0.4, fontFace: F, fontSize: 18, color: PRIMARY_DIM, margin: 0, align: "center" });
    }
  });

  // screenshot: practice-trigger-lock.png (1440x900)
  const iw = 6.4, ih = iw * (900 / 1440);
  s.addImage({ path: "docs/screenshots/practice-trigger-lock.png", x: M, y: 3.1, w: iw, h: ih });
  s.addText("Live prototype — feedback quotes the expert's own recovery rule.", {
    x: M, y: 3.1 + ih + 0.06, w: iw, h: 0.32, fontFace: F, fontSize: 10.5, color: MUTED, italic: true, margin: 0,
  });

  card(s, 7.25, 3.1, 5.58, 3.95, PANEL);
  s.addText("DESIGN PRINCIPLES", { x: 7.5, y: 3.35, w: 5.1, h: 0.32, fontFace: FM, fontSize: 12, color: ACCENT, margin: 0, charSpacing: 1 });
  s.addText([
    { text: "The expert stays the author — nothing trains without approval", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Every claim links to a verbatim transcript moment", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Missing knowledge stays visibly incomplete, never invented", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Practice checks decisions; bench observation stays human", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: 7.5, y: 3.77, w: 5.15, h: 3.1, fontFace: F, fontSize: 13.5, color: TEXT, margin: 0, paraSpaceAfter: 14 });
}

// ========================================================================
// SLIDE 4 — Architecture & privacy
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };

  s.addText("Built like an instrument: local by default", {
    x: M, y: 0.5, w: 12.3, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: TEXT, margin: 0,
  });

  const box = (x, y, w, h, title, sub, accent = false) => {
    card(s, x, y, w, h, accent ? PANEL2 : PANEL);
    s.addText(title, { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: 0.32, fontFace: FM, fontSize: 12.5, bold: true, color: accent ? ACCENT : PRIMARY, margin: 0 });
    s.addText(sub, { x: x + 0.15, y: y + 0.45, w: w - 0.3, h: h - 0.55, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });
  };
  const arrow = (x, y) => s.addText("▸", { x, y, w: 0.3, h: 0.35, fontFace: F, fontSize: 16, color: PRIMARY_DIM, margin: 0, align: "center" });

  // pipeline row 1
  box(M, 1.4, 2.6, 1.0, "RECORDING", "video/audio · local disk, never uploaded");
  arrow(3.18, 1.7);
  box(3.5, 1.4, 2.6, 1.0, "TRANSCRIBE", "faster-whisper small.en · CPU INT8 · on-device");
  arrow(6.18, 1.7);
  box(6.5, 1.4, 3.3, 1.0, "EXTRACT (provider adapter)", "structured JSON + verbatim evidence refs");
  arrow(9.88, 1.7);
  box(10.2, 1.4, 2.63, 1.0, "VALIDATE", "schema + evidence-vs-transcript check");

  // pipeline row 2
  box(6.5, 2.75, 3.3, 1.0, "REVIEW & APPROVE", "expert editor; approval gating; version history");
  arrow(6.18, 3.05);
  box(3.5, 2.75, 2.6, 1.0, "LESSON STORE", "SQLite · draft/approved versions · attempts");
  arrow(10.88, 3.05);
  box(10.2, 2.75, 2.63, 1.0, "PRACTICE", "scope simulator · server-recomputed scores");

  // provider box
  card(s, M, 2.75, 2.6, 1.0, PANEL2);
  s.addText("EXTRACT PROVIDERS", { x: M + 0.15, y: 2.87, w: 2.3, h: 0.3, fontFace: FM, fontSize: 11, bold: true, color: ACCENT, margin: 0 });
  s.addText("NVIDIA NIM (gated) · Ollama local · bundled offline", { x: M + 0.15, y: 3.18, w: 2.3, h: 0.5, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });

  // stack + guarantees
  card(s, M, 4.2, 6.0, 2.7);
  s.addText("STACK", { x: M + 0.25, y: 4.45, w: 2.0, h: 0.3, fontFace: FM, fontSize: 12, color: ACCENT, margin: 0, charSpacing: 1 });
  s.addText([
    { text: "React + TypeScript + Vite — canvas oscilloscope simulator", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "FastAPI + SQLite (WAL) — background jobs with progress & failure states", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "faster-whisper INT8 on CPU — extraction caching, bounded LLM requests", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Single-command offline demo — frontend served by the backend", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: M + 0.25, y: 4.82, w: 5.5, h: 2.0, fontFace: F, fontSize: 12.5, color: TEXT, margin: 0, paraSpaceAfter: 9 });

  card(s, 6.85, 4.2, 5.98, 2.7);
  s.addText("GUARANTEES ENFORCED IN CODE", { x: 7.1, y: 4.45, w: 5.5, h: 0.3, fontFace: FM, fontSize: 12, color: ACCENT, margin: 0, charSpacing: 1 });
  s.addText([
    { text: "Recordings stay on-device; only transcript text reaches a hosted model, if enabled", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "No silent switching to paid providers — auto only steps down: hosted → local → offline", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Unapproved lessons invisible to trainees — 403 enforced server-side", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Hallucinated citations rejected — quotes must match the transcript", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: 7.1, y: 4.82, w: 5.5, h: 2.0, fontFace: F, fontSize: 12.5, color: TEXT, margin: 0, paraSpaceAfter: 9 });
}

// ========================================================================
// SLIDE 5 — Validation
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };

  s.addText("Verified the way engineers verify — not slideware", {
    x: M, y: 0.5, w: 12.3, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: TEXT, margin: 0,
  });

  const stats = [
    ["16/16", "automated end-to-end checks passing", PRIMARY],
    ["100%", "offline demo capability — zero network, zero keys", PRIMARY],
    ["0", "paid API calls in the default configuration", ACCENT],
    ["5", "guided simulator steps incl. a recovery scenario", PRIMARY],
  ];
  stats.forEach(([n, label, c], i) => {
    const x = M + i * 3.14;
    s.addText(n, { x, y: 1.35, w: 2.9, h: 0.95, fontFace: F, fontSize: 54, bold: true, color: c, margin: 0 });
    s.addText(label, { x, y: 2.32, w: 2.75, h: 0.65, fontFace: F, fontSize: 12.5, color: MUTED, margin: 0 });
  });

  s.addShape(pres.shapes.LINE, { x: M, y: 3.2, w: W - 2 * M, h: 0, line: { color: HAIR, width: 0.75 } });

  s.addText("What the automated suite proves", { x: M, y: 3.42, w: 6.0, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: PRIMARY, margin: 0 });
  s.addText([
    { text: "Trainee cannot fetch an unapproved lesson — 403, server-enforced", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Out-of-range or non-matching evidence references rejected before review", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Approval blocked while any follow-up question is unresolved", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Attempt scores recomputed server-side — client cannot fake a 100", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Data survives restart; interrupted jobs marked failed, never stuck", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: M, y: 3.9, w: 6.1, h: 2.6, fontFace: F, fontSize: 12.5, color: TEXT, margin: 0, paraSpaceAfter: 9 });

  s.addText("What we ran live", { x: 7.0, y: 3.42, w: 5.8, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: PRIMARY, margin: 0 });
  s.addText([
    { text: "Full browser walkthrough: capture → review (answers + approval) → practice (all 5 steps) → attempt stored", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Wrong adjustment penalised exactly as designed (95/100 with one mistake)", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Provider failure paths: malformed AI output, dead provider, oversized upload — all fail loudly with guidance", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Health & provider readiness surfaced in the UI (hosted/local/offline provenance)", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: 7.0, y: 3.9, w: 5.85, h: 2.3, fontFace: F, fontSize: 12.5, color: TEXT, margin: 0, paraSpaceAfter: 9 });

  s.addText("Planned effectiveness study (disclosed, small-sample): trainees with Takumi vs. conventional written instructions — measure completion time, mistakes, assistance needed. No effectiveness claims until measured.", {
    x: M, y: 6.55, w: 12.3, h: 0.55, fontFace: F, fontSize: 11.5, italic: true, color: MUTED, margin: 0,
  });
  s.addText("Source: Takumi test suite & verification log, docs/VERIFICATION.md, October 2026.", {
    x: M, y: 7.08, w: 10, h: 0.3, fontFace: FM, fontSize: 10.5, color: PRIMARY_DIM, margin: 0,
  });
}

// ========================================================================
// SLIDE 6 — Adoption & the ask (close)
// ========================================================================
{
  const s = pres.addSlide();
  s.background = { color: BG };
  graticule(s);

  s.addText("Where Takumi goes after the bench", {
    x: M, y: 0.55, w: 12.3, h: 0.6, fontFace: F, fontSize: 30, bold: true, color: TEXT, margin: 0,
  });

  s.addText("Business hypothesis — to be validated with customers, not assumed", {
    x: M, y: 1.32, w: 11.5, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: ACCENT, margin: 0,
  });
  s.addText("Organisation subscription for teams that must inherit skills: Japanese SMEs onboarding an Indian workforce, maintenance & vocational training institutes, and manufacturing partners — the exact corridor JETRO serves. Pilots would measure time-to-competence before any pricing claim.", {
    x: M, y: 1.78, w: 12.0, h: 0.85, fontFace: F, fontSize: 13.5, color: MUTED, margin: 0,
  });

  const cols = [
    ["WHO PAYS", "Factories, training institutes, service organisations with retiring experts and rotating trainees."],
    ["WHY US", "Evidence-verified lessons, expert-in-the-loop approval, offline-capable — built for shop floors, not just offices."],
    ["PILOT PLAN", "3 departments · 2 lessons each · measure time-to-competence and mistakes vs. current handover method."],
  ];
  cols.forEach(([h, d], i) => {
    const x = M + i * 4.22;
    card(s, x, 2.9, 3.95, 1.7);
    s.addText(h, { x: x + 0.22, y: 3.1, w: 3.5, h: 0.32, fontFace: FM, fontSize: 12.5, bold: true, color: PRIMARY, margin: 0, charSpacing: 1 });
    s.addText(d, { x: x + 0.22, y: 3.48, w: 3.5, h: 1.0, fontFace: F, fontSize: 12.5, color: TEXT, margin: 0 });
  });

  s.addShape(pres.shapes.LINE, { x: M, y: 5.0, w: W - 2 * M, h: 0, line: { color: HAIR, width: 0.75 } });

  s.addText("THE ASK", { x: M, y: 5.2, w: 3, h: 0.32, fontFace: FM, fontSize: 13, bold: true, color: ACCENT, margin: 0, charSpacing: 2 });
  s.addText([
    { text: "One JETRO-introduced factory or training partner for a real pilot recording", options: { bullet: { code: "2013", indent: 12 }, breakLine: true } },
    { text: "Mentor feedback on the evidence-validation approach for industrial know-how", options: { bullet: { code: "2013", indent: 12 } } },
  ], { x: M, y: 5.55, w: 8.3, h: 0.95, fontFace: F, fontSize: 13.5, color: TEXT, margin: 0, paraSpaceAfter: 8 });

  s.addText([
    { text: "18 OCT ", options: { fontFace: FM, bold: true, color: ACCENT, fontSize: 14 } },
    { text: "Round-1 submission      ", options: { color: MUTED, fontSize: 12.5 } },
    { text: "24–25 OCT ", options: { fontFace: FM, bold: true, color: ACCENT, fontSize: 14 } },
    { text: "live build & pitch — demo runs offline from one command", options: { color: MUTED, fontSize: 12.5 } },
  ], { x: M, y: 6.7, w: 12.3, h: 0.4, fontFace: F, margin: 0 });

  s.addText("匠  Takumi — bridging tradition and innovation, one demonstration at a time.", {
    x: M, y: 7.05, w: 11, h: 0.35, fontFace: F, fontSize: 12, italic: true, color: PRIMARY_DIM, margin: 0,
  });
}

pres.writeFile({ fileName: "docs/Takumi_Round1_JETRO-PS-03.pptx" }).then(() => console.log("deck written"));
