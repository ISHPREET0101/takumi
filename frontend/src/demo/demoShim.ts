/**
 * Static demo backend — a fetch interceptor that serves the bundled sample
 * lesson so the deployed frontend is self-contained (Vercel can't run the
 * Python backend: no background jobs, no persistent disk, no whisper model).
 *
 * Review -> answer questions -> approve -> practice works fully in the
 * browser; mutable state persists in localStorage. Enable with
 * VITE_DEMO_MODE=1 at build time.
 */
import sample from "./demo_sample.json";

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "1";

const REC_ID = "demo-rec-1";
const LESSON_ID = "demo-lesson-1";
const VER_ID = "demo-ver-1";
const LS_KEY = "takumi_demo_state_v1";

interface DemoSegment {
  seg: number;
  start: number;
  end: number;
  text: string;
  edited_text: string | null;
}

interface DemoQuestion {
  id: string;
  question: string;
  why_missing: string;
  answer: string;
  status: "open" | "answered" | "dismissed";
}

interface DemoState {
  segments: DemoSegment[];
  title: string;
  summary: string;
  steps: unknown[];
  questions: DemoQuestion[];
  approved: boolean;
  approved_at: string | null;
  version_number: number;
  attempts: { id: string; trainee_name: string; score: number; duration_ms: number; created_at: string; lesson_version_id: string }[];
}

const CREATED = "2026-10-05T10:36:59+00:00";

function seedState(): DemoState {
  return {
    segments: (sample.transcript as { start: number; end: number; text: string }[]).map((s, i) => ({
      seg: i,
      start: s.start,
      end: s.end,
      text: s.text,
      edited_text: null,
    })),
    title: sample.extraction.title,
    summary: sample.extraction.summary,
    steps: JSON.parse(JSON.stringify(sample.extraction.steps)),
    questions: (sample.extraction.questions as { question: string; why_missing: string }[]).map((q, i) => ({
      id: `q${i + 1}`,
      question: q.question,
      why_missing: q.why_missing,
      answer: "",
      status: "open" as const,
    })),
    approved: false,
    approved_at: null,
    version_number: 1,
    attempts: [],
  };
}

function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as DemoState;
  } catch {
    /* corrupted state — reseed */
  }
  const s = seedState();
  saveState(s);
  return s;
}

function saveState(s: DemoState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — demo still works in-memory */
  }
}

let state = isDemoMode ? loadState() : (null as unknown as DemoState);

function versionSummary() {
  return {
    id: VER_ID,
    lesson_id: LESSON_ID,
    version_number: state.version_number,
    title: state.title,
    status: state.approved ? "approved" : "draft",
    provenance: "saved_demo",
    provider: "saved_demo",
    model: "bundled-sample",
    cached: false,
    created_at: CREATED,
    approved_at: state.approved_at,
    changelog: null as string | null,
  };
}

function recordingSummary() {
  return {
    id: REC_ID,
    original_name: "sample_oscilloscope_demo.wav (bundled synthetic sample)",
    media_kind: "audio",
    size_bytes: 3424044,
    duration_sec: 214.0,
    is_demo: true,
    created_at: CREATED,
    segment_count: state.segments.length,
    lesson: { id: LESSON_ID, title: state.title },
    job: {
      id: "demo-job-1",
      recording_id: REC_ID,
      status: "succeeded",
      stage: "done",
      progress: 100,
      error: null,
      provider: "saved_demo",
      model: "bundled-sample",
      lesson_id: LESSON_ID,
    },
  };
}

function lessonSummary() {
  return {
    id: LESSON_ID,
    recording_id: REC_ID,
    title: state.title,
    created_at: CREATED,
    approved_version_id: state.approved ? VER_ID : null,
    current_version: versionSummary(),
  };
}

function versionDetail() {
  return {
    ...versionSummary(),
    summary: state.summary,
    steps: state.steps,
    questions: state.questions,
    lesson: { id: LESSON_ID, recording_id: REC_ID, approved_version_id: state.approved ? VER_ID : null },
    transcript: state.segments,
  };
}

function lessonDetail() {
  return {
    ...lessonSummary(),
    current_version_id: VER_ID,
    versions: [versionSummary()],
    transcript: state.segments,
    attempts: state.attempts,
    recording: {
      id: REC_ID,
      original_name: "sample_oscilloscope_demo.wav (bundled synthetic sample)",
      media_kind: "audio",
      is_demo: true,
    },
  };
}

const DEMO_UPLOAD_MSG =
  "Static demo: capture and processing run in the local desktop app. This deployment ships with the bundled sample lesson — walk it through Review -> Approve -> Practice.";

/* --- evidence quote matching (mirrors backend tolerance) --- */
function normalizeText(t: string): string {
  return (t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenOverlap(a: string, b: string): number {
  const sa = new Set(normalizeText(a).split(" ").filter(Boolean));
  const sb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.min(sa.size, sb.size);
}
function quoteMatches(quote: string, seg: DemoSegment): boolean {
  const a = normalizeText(quote);
  if (!a) return false;
  for (const text of [seg.text, seg.edited_text ?? ""]) {
    const b = normalizeText(text);
    if (!b) continue;
    if (b.includes(a) || a.includes(b)) return true;
    if (tokenOverlap(a, b) >= 0.6) return true;
  }
  return false;
}

function approvalErrors(): string[] {
  const errs: string[] = [];
  const steps = state.steps as { evidence: { seg: number; quote: string }[] }[];
  steps.forEach((s, i) => {
    if (!s.evidence?.length) errs.push(`Step ${i + 1} has no evidence`);
    s.evidence?.forEach((e) => {
      const seg = state.segments.find((t) => t.seg === e.seg);
      if (!seg) errs.push(`Step ${i + 1}: evidence seg ${e.seg} out of range`);
      else if (!quoteMatches(e.quote, seg)) errs.push(`Step ${i + 1}: quote does not match segment ${e.seg}`);
    });
  });
  state.questions.forEach((q) => {
    if (q.status === "answered" && !q.answer.trim()) errs.push(`Question ${q.id} marked answered but empty`);
    if (q.status === "open") errs.push(`question '${q.id}' is unresolved`);
  });
  return errs;
}

function recomputeScore(steps: { passed: boolean; wrong_adjustments: number; assists: number }[]): number {
  if (!steps.length) return 0;
  const total = steps.reduce(
    (acc, s) => acc + (s.passed ? Math.max(0, 1 - 0.25 * (s.wrong_adjustments || 0) - 0.15 * (s.assists || 0)) : 0),
    0,
  );
  return Math.max(0, Math.min(100, Math.round((100 * total) / steps.length)));
}

function silenceWav(seconds: number, sampleRate = 8000): ArrayBuffer {
  const n = seconds * sampleRate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  return buf;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const notFound = (msg = "not found") => json({ detail: msg }, 404);

async function handle(path: string, method: string, body: any): Promise<Response> {
  const segMatch = path.match(/^\/api\/recordings\/([^/]+)\/transcript\/(\d+)$/);
  const qMatch = path.match(/^\/api\/lesson-versions\/([^/]+)\/questions\/([^/]+)$/);

  if (path === "/api/health" && method === "GET") {
    return json({
      status: "ok",
      app: "Takumi (static demo)",
      whisper_available: false,
      whisper_model: "n/a (static demo)",
      default_provider: "saved_demo (bundled)",
      providers: {
        nvidia: { enabled: false, key_present: false, model: "-", base_url: "-", note: "processing runs in the local desktop app" },
        ollama: { reachable: false, model: "-", base_url: "-" },
        saved_demo: { available: true },
      },
    });
  }

  if (path === "/api/recordings" && method === "GET") return json([recordingSummary()]);
  if (path === "/api/recordings" && method === "POST") return json({ detail: DEMO_UPLOAD_MSG }, 501);
  if (path === `/api/recordings/${REC_ID}/reprocess`) return json({ detail: DEMO_UPLOAD_MSG }, 501);
  if (path === `/api/recordings/${REC_ID}/media` && method === "GET") {
    return new Response(silenceWav(214), {
      headers: { "Content-Type": "audio/wav", "Accept-Ranges": "none" },
    });
  }
  if (path === `/api/recordings/${REC_ID}` && method === "GET") {
    return json({ ...recordingSummary(), transcript: state.segments });
  }
  if (segMatch && method === "PATCH") {
    const seg = state.segments.find((s) => s.seg === Number(segMatch[2]));
    if (!seg) return notFound("segment not found");
    seg.edited_text = String(body.text || "").trim();
    saveState(state);
    return json({ seg: seg.seg, text: seg.text, edited_text: seg.edited_text });
  }

  if (path === "/api/lessons" && method === "GET") return json([lessonSummary()]);
  if (path === `/api/lessons/${LESSON_ID}/attempts` && method === "GET") return json(state.attempts);
  if (path === `/api/lessons/${LESSON_ID}` && method === "GET") return json(lessonDetail());
  if (path === `/api/lesson-versions/${VER_ID}` && method === "GET") return json(versionDetail());

  if (path === `/api/lesson-versions/${VER_ID}` && method === "PUT") {
    if (state.approved) {
      // editing an approved version starts the next draft (demo keeps one version slot)
      state.version_number += 1;
      state.approved = false;
      state.approved_at = null;
    }
    state.title = String(body.title || state.title);
    state.summary = String(body.summary ?? state.summary);
    state.steps = body.steps ?? state.steps;
    state.questions = body.questions ?? state.questions;
    saveState(state);
    return json({ id: VER_ID, status: "draft" });
  }

  if (qMatch && method === "POST") {
    const q = state.questions.find((x) => x.id === qMatch[2]);
    if (!q) return notFound("question not found");
    if (body.dismiss) {
      q.status = "dismissed";
      q.answer = "";
    } else {
      if (!String(body.answer || "").trim()) return json({ detail: "answer must not be empty (or send dismiss=true)" }, 422);
      q.status = "answered";
      q.answer = String(body.answer).trim();
    }
    saveState(state);
    return json({ id: q.id, status: q.status, answer: q.answer });
  }

  if (path === `/api/lesson-versions/${VER_ID}/approve` && method === "POST") {
    if (state.approved) return json({ detail: "version already approved" }, 409);
    const errs = approvalErrors();
    if (errs.length) return json({ detail: { message: "cannot approve yet", errors: errs } }, 422);
    state.approved = true;
    state.approved_at = new Date().toISOString();
    saveState(state);
    return json({ id: VER_ID, status: "approved", approved_at: state.approved_at });
  }

  if (path === "/api/trainee/lessons" && method === "GET") {
    return json(
      state.approved
        ? [
            {
              id: LESSON_ID,
              title: state.title,
              summary: state.summary,
              version_number: state.version_number,
              provenance: "saved_demo",
              step_count: (state.steps as unknown[]).length,
            },
          ]
        : [],
    );
  }
  if (path === `/api/trainee/lessons/${LESSON_ID}/attempts`) {
    if (method === "GET") return json(state.attempts);
    if (method === "POST") {
      if (!state.approved) return json({ detail: "lesson_not_approved" }, 403);
      const steps = (body.steps || []) as { step_id: string; title?: string; passed: boolean; wrong_adjustments?: number; assists?: number }[];
      const stepIds = new Set((state.steps as { id: string }[]).map((s) => s.id));
      if (steps.some((s) => !stepIds.has(s.step_id)))
        return json({ detail: "attempt references steps outside the approved version" }, 422);
      const scored = steps.map((s) => ({
        passed: !!s.passed,
        wrong_adjustments: s.wrong_adjustments ?? 0,
        assists: s.assists ?? 0,
      }));
      const attempt = {
        id: `demo-attempt-${Date.now()}`,
        trainee_name: String(body.trainee_name || "demo trainee"),
        score: recomputeScore(scored),
        duration_ms: Number(body.duration_ms || 0),
        created_at: new Date().toISOString(),
        lesson_version_id: VER_ID,
      };
      state.attempts.unshift(attempt);
      saveState(state);
      return json({ id: attempt.id, score: attempt.score, lesson_version_id: VER_ID, stored: true });
    }
  }
  if (path === `/api/trainee/lessons/${LESSON_ID}` && method === "GET") {
    if (!state.approved) return json({ detail: "lesson_not_approved" }, 403);
    return json({
      id: LESSON_ID,
      version_number: state.version_number,
      title: state.title,
      summary: state.summary,
      steps: state.steps,
      provenance: "saved_demo",
      recording: { id: REC_ID, original_name: "sample_oscilloscope_demo.wav", media_kind: "audio", is_demo: true },
    });
  }

  return notFound(`no demo handler for ${method} ${path}`);
}

/** Installs the interceptor. Call once, before the app renders. */
export function installDemoShim() {
  state = loadState();
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (!path.startsWith("/api/")) return originalFetch(input, init);
    let body: unknown = undefined;
    try {
      if (init?.body) body = JSON.parse(String(init.body));
    } catch {
      body = undefined;
    }
    try {
      return await handle(path, (init?.method || "GET").toUpperCase(), body);
    } catch (e) {
      return json({ detail: `demo shim error: ${String(e)}` }, 500);
    }
  };
  console.info("[takumi] static demo mode active — bundled sample lesson, state in localStorage");
}
