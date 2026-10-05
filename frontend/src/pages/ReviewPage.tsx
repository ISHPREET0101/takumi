import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type {
  LessonDetail,
  LessonStep,
  LessonSummary,
  LessonVersionDetail,
  TranscriptSegment,
} from "../types";
import ProvenanceBadge from "../components/ProvenanceBadge";

/* ---- quote matching (display hint only; the server is authoritative) ---- */
function normalizeText(t: string): string {
  return (t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenOverlap(a: string, b: string): number {
  const sa = new Set(normalizeText(a).split(" ").filter(Boolean));
  const sb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.min(sa.size, sb.size);
}
export function quoteMatches(quote: string, seg: TranscriptSegment): boolean {
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

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface Draft {
  title: string;
  summary: string;
  steps: LessonStep[];
  questions: LessonVersionDetail["questions"];
  changelog: string;
}

function stepEvidenceValid(step: LessonStep, transcript: TranscriptSegment[]): boolean {
  return (
    step.evidence.length > 0 &&
    step.evidence.every((e) => {
      const seg = transcript.find((s) => s.seg === e.seg);
      return seg ? quoteMatches(e.quote, seg) : false;
    })
  );
}

export default function ReviewPage({ initialLessonId }: { initialLessonId: string | null }) {
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [lessonId, setLessonId] = useState<string | null>(initialLessonId);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [version, setVersion] = useState<LessonVersionDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const loadLessons = useCallback(async () => {
    setLessons(await api.listLessons());
  }, []);

  const loadLesson = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const detail = await api.getLesson(id);
      setLesson(detail);
      const vid = detail.current_version_id;
      if (vid) {
        const v = await api.getVersion(vid);
        setVersion(v);
        setVersionId(vid);
        setDraft({ title: v.title, summary: v.summary, steps: v.steps, questions: v.questions, changelog: v.changelog ?? "" });
      } else {
        setVersion(null);
        setVersionId(null);
        setDraft(null);
      }
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLessons();
  }, [loadLessons]);

  useEffect(() => {
    if (lessonId) void loadLesson(lessonId).catch((e) => setError(String(e)));
  }, [lessonId, loadLesson]);

  const transcript = version?.transcript ?? lesson?.transcript ?? [];
  const isApprovedVersion = version?.status === "approved";

  const evidenceErrors = useMemo(() => {
    if (!draft) return [] as string[];
    const errs: string[] = [];
    draft.steps.forEach((s, i) => {
      if (s.evidence.length === 0) errs.push(`Step ${i + 1} has no evidence`);
      s.evidence.forEach((e) => {
        const seg = transcript.find((t) => t.seg === e.seg);
        if (!seg) errs.push(`Step ${i + 1}: evidence seg ${e.seg} out of range`);
        else if (!quoteMatches(e.quote, seg)) errs.push(`Step ${i + 1}: quote does not match segment ${e.seg}`);
      });
    });
    draft.questions.forEach((q) => {
      if (q.status === "answered" && !q.answer.trim()) errs.push(`Question ${q.id} marked answered but empty`);
    });
    return errs;
  }, [draft, transcript]);

  const unresolved = draft ? draft.questions.filter((q) => q.status === "open").length : 0;
  const canApprove = !!draft && evidenceErrors.length === 0 && unresolved === 0 && !dirty;

  const seek = (sec: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = sec;
    void el.play().catch(() => undefined);
  };

  const updateStep = (idx: number, patch: Partial<LessonStep>) => {
    if (!draft) return;
    const steps = draft.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDraft({ ...draft, steps });
    setDirty(true);
  };

  const saveDraft = async () => {
    if (!draft || !versionId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateVersion(versionId, {
        title: draft.title,
        summary: draft.summary,
        steps: draft.steps,
        questions: draft.questions,
        changelog: draft.changelog,
      });
      setNotice(
        res.status === "draft" && res.id !== versionId
          ? "Saved as a new draft version (the previous version stays approved)."
          : "Draft saved.",
      );
      setDirty(false);
      await loadLesson(lesson!.id);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!versionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveVersion(versionId);
      setNotice("Lesson approved — trainees can now practice this version.");
      await loadLesson(lesson!.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLessonAsText = async () => {
    if (!version || !draft) return;
    const lines: string[] = [];
    lines.push(`TAKUMI LESSON — ${draft.title} (v${version.version_number}, ${version.status})`);
    if (draft.summary) lines.push(`\nSummary: ${draft.summary}`);
    draft.steps.forEach((s, i) => {
      lines.push(`\nSTEP ${i + 1}: ${s.title}`);
      lines.push(`Instructions: ${s.instructions}`);
      if (s.rationale) lines.push(`Why (expert): ${s.rationale}`);
      if (s.success_cues.length) lines.push(`Success cues:\n${s.success_cues.map((c) => `- ${c}`).join("\n")}`);
      if (s.common_mistakes.length) lines.push(`Common mistakes:\n${s.common_mistakes.map((c) => `- ${c}`).join("\n")}`);
      if (s.recovery) lines.push(`Recovery: ${s.recovery}`);
      if (s.evidence.length) lines.push(`Evidence: ${s.evidence.map((e) => `seg ${e.seg} "${e.quote}"`).join("; ")}`);
    });
    if (draft.questions.length) {
      lines.push("\nFOLLOW-UP QUESTIONS");
      draft.questions.forEach((q) => {
        lines.push(
          `Q: ${q.question}\nA: ${q.status === "answered" ? q.answer : q.status === "dismissed" ? "(dismissed)" : "(unresolved)"}`,
        );
      });
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("Lesson copied to clipboard as text.");
    } catch {
      setError("Clipboard write failed — the browser blocked it.");
    }
  };

  const answerQuestion = async (qid: string, body: { answer?: string; dismiss: boolean }) => {
    if (!versionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.answerQuestion(versionId, qid, body);
      const v = await api.getVersion(versionId);
      setVersion(v);
      setDraft({ title: v.title, summary: v.summary, steps: v.steps, questions: v.questions, changelog: v.changelog ?? "" });
      setNotice(body.dismiss ? "Question dismissed." : "Answer saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const editSegment = async (seg: number, text: string) => {
    if (!lesson) return;
    setBusy(true);
    setError(null);
    try {
      await api.editSegment(lesson.recording_id!, seg, text);
      await loadLesson(lesson.id);
      setNotice(`Segment ${seg} updated.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <section className="card">
        <h2>Expert review</h2>
        <div className="row">
          <select
            className="select"
            value={lessonId ?? ""}
            onChange={(e) => {
              setNotice(null);
              setError(null);
              setLessonId(e.target.value || null);
            }}
          >
            <option value="">— choose a lesson —</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} {l.approved_version_id ? "✓ approved" : "(draft)"}
              </option>
            ))}
          </select>
          {version && (
            <select
              className="select"
              value={versionId ?? ""}
              onChange={(e) => {
                const v = lesson?.versions.find((x) => x.id === e.target.value);
                if (!v) return;
                setVersionId(v.id);
                void api.getVersion(v.id).then((detail) => {
                  setVersion(detail);
                  setDraft({ title: detail.title, summary: detail.summary, steps: detail.steps, questions: detail.questions, changelog: detail.changelog ?? "" });
                  setDirty(false);
                });
              }}
            >
              {lesson?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} · {v.status}
                </option>
              ))}
            </select>
          )}
          {version && (
            <ProvenanceBadge provenance={version.provenance} provider={version.provider} model={version.model} cached={version.cached} />
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}
        {isApprovedVersion && (
          <div className="banner info">
            This version is <strong>approved</strong> and visible to trainees. Saving edits will create a new draft
            version.
          </div>
        )}
      </section>

      {!loading && !lesson && <p className="muted">Select a lesson to review.</p>}
      {loading && !lesson && <p className="muted">Loading lesson…</p>}

      {lesson && version && draft && (
        <>
          <div className="review-grid">
            {/* ---- transcript + media ---- */}
            <section className="card">
              <h3>Transcript</h3>
              {lesson.recording_id && lesson.recording && (
                lesson.recording.media_kind === "video" ? (
                  <video ref={mediaRef as React.RefObject<HTMLVideoElement>} controls className="media" src={api.mediaUrl(lesson.recording_id)} />
                ) : (
                  <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} controls className="media-full" src={api.mediaUrl(lesson.recording_id)} />
                )
              )}
              <p className="muted small">Click a segment to play from that timestamp. Edit text to correct transcription mistakes — evidence quotes stay valid against the original text.</p>
              <div className="segments">
                {transcript.map((s) => (
                  <div key={s.seg} className="segment" onClick={() => seek(s.start)}>
                    <span className="seg-ts" title={`segment ${s.seg}`}>
                      {fmtSec(s.start)}–{fmtSec(s.end)}
                    </span>
                    <SegmentText segment={s} onSave={(t) => void editSegment(s.seg, t)} />
                  </div>
                ))}
              </div>
            </section>

            {/* ---- draft editor ---- */}
            <section className="card">
              <h3>Lesson draft</h3>
              <label className="field-label">Title</label>
              <input
                className="input"
                value={draft.title}
                onChange={(e) => {
                  setDraft({ ...draft, title: e.target.value });
                  setDirty(true);
                }}
              />
              <label className="field-label">Summary</label>
              <textarea
                className="input"
                rows={2}
                value={draft.summary}
                onChange={(e) => {
                  setDraft({ ...draft, summary: e.target.value });
                  setDirty(true);
                }}
              />

              {draft.steps.map((step, i) => (
                <StepEditor
                  key={step.id}
                  step={step}
                  index={i}
                  transcript={transcript}
                  onChange={(patch) => updateStep(i, patch)}
                  invalid={!stepEvidenceValid(step, transcript)}
                />
              ))}

              <h3>Follow-up questions ({unresolved} unresolved)</h3>
              <p className="muted small">
                Generated where the expert's reasoning was implied but unstated. Approving requires every question to be
                answered or explicitly dismissed.
              </p>
              {draft.questions.map((q) => (
                <QuestionCard key={q.id} q={q} busy={busy} onSubmit={answerQuestion} />
              ))}

              <div className="approval-bar">
                <div>
                  <div className={`status-line ${evidenceErrors.length || unresolved ? "bad" : "good"}`}>
                    {evidenceErrors.length === 0 && unresolved === 0
                      ? "All evidence valid, all questions resolved."
                      : `${evidenceErrors.length} evidence issue(s), ${unresolved} unresolved question(s).`}
                  </div>
                  {evidenceErrors.slice(0, 4).map((e, i) => (
                    <div key={i} className="small bad-text">• {e}</div>
                  ))}
                  {dirty && <div className="small muted">Unsaved changes — save before approving.</div>}
                </div>
                <div className="btn-row">
                  <button className="btn ghost" disabled={busy} onClick={() => void copyLessonAsText()}>
                    Copy as text
                  </button>
                  <button className="btn" disabled={busy || !dirty} onClick={() => void saveDraft()}>
                    {busy ? "Working…" : isApprovedVersion ? "Save (creates next draft)" : "Save draft"}
                  </button>
                  <button className="btn primary" disabled={!canApprove || busy} onClick={() => void approve()}>
                    Approve version
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <h3>Practice attempts ({lesson.attempts.length})</h3>
            {lesson.attempts.length === 0 && <p className="muted">No attempts recorded yet.</p>}
            {lesson.attempts.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Trainee</th>
                    <th>Score</th>
                    <th>Duration</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {lesson.attempts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.trainee_name}</td>
                      <td>{a.score}/100</td>
                      <td>{Math.round((a.duration_ms ?? 0) / 1000)}s</td>
                      <td>{new Date(a.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SegmentText({ segment, onSave }: { segment: TranscriptSegment; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(segment.edited_text ?? segment.text);
  useEffect(() => setValue(segment.edited_text ?? segment.text), [segment]);
  if (editing) {
    return (
      <span className="seg-edit">
        <textarea
          className="input"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="btn-row">
          <button
            className="btn small-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSave(value);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            className="btn small-btn ghost"
            onClick={(e) => {
              e.stopPropagation();
              setValue(segment.edited_text ?? segment.text);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </span>
      </span>
    );
  }
  return (
    <span className="seg-text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
      {segment.edited_text ?? segment.text}
      {segment.edited_text && <span className="chip edited-chip">edited</span>}
    </span>
  );
}

function StepEditor({
  step,
  index,
  transcript,
  onChange,
  invalid,
}: {
  step: LessonStep;
  index: number;
  transcript: TranscriptSegment[];
  onChange: (patch: Partial<LessonStep>) => void;
  invalid: boolean;
}) {
  const [newSeg, setNewSeg] = useState("0");
  const [newQuote, setNewQuote] = useState("");
  return (
    <div className={`step-card ${invalid ? "step-invalid" : ""}`}>
      <div className="step-head">
        <strong>
          Step {index + 1}: {step.title}
        </strong>
        {step.simulator && <span className="chip sim-chip">sim: {step.simulator.task}</span>}
        {invalid && <span className="chip err-chip">evidence invalid</span>}
      </div>
      <label className="field-label">Instructions</label>
      <textarea className="input" rows={2} value={step.instructions} onChange={(e) => onChange({ instructions: e.target.value })} />
      <label className="field-label">Rationale (expert's why)</label>
      <textarea className="input" rows={2} value={step.rationale} onChange={(e) => onChange({ rationale: e.target.value })} />
      <div className="two-col">
        <div>
          <label className="field-label">Success cues (one per line)</label>
          <textarea
            className="input"
            rows={3}
            value={step.success_cues.join("\n")}
            onChange={(e) => onChange({ success_cues: e.target.value.split("\n").filter((x) => x.trim()) })}
          />
        </div>
        <div>
          <label className="field-label">Common mistakes (one per line)</label>
          <textarea
            className="input"
            rows={3}
            value={step.common_mistakes.join("\n")}
            onChange={(e) => onChange({ common_mistakes: e.target.value.split("\n").filter((x) => x.trim()) })}
          />
        </div>
      </div>
      <label className="field-label">Recovery guidance</label>
      <textarea className="input" rows={2} value={step.recovery} onChange={(e) => onChange({ recovery: e.target.value })} />

      <div className="evidence-box">
        <label className="field-label">Evidence references</label>
        {step.evidence.map((e, j) => {
          const seg = transcript.find((t) => t.seg === e.seg);
          const ok = seg ? quoteMatches(e.quote, seg) : false;
          return (
            <div key={j} className={`evidence-chip ${ok ? "" : "ev-bad"}`} title={e.quote}>
              <span className="ev-seg">seg {e.seg}</span>
              <span className="ev-quote">"{e.quote.length > 70 ? e.quote.slice(0, 70) + "…" : e.quote}"</span>
              {!ok && <span className="ev-flag">✗</span>}
              <button
                className="ev-x"
                title="remove evidence"
                onClick={() => onChange({ evidence: step.evidence.filter((_, k) => k !== j) })}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="evidence-add">
          <select className="select small-select" value={newSeg} onChange={(e) => setNewSeg(e.target.value)}>
            {transcript.map((t) => (
              <option key={t.seg} value={t.seg}>
                seg {t.seg} ({fmtSec(t.start)})
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Verbatim quote from that segment"
            value={newQuote}
            onChange={(e) => setNewQuote(e.target.value)}
          />
          <button
            className="btn small-btn"
            onClick={() => {
              if (!newQuote.trim()) return;
              onChange({ evidence: [...step.evidence, { seg: parseInt(newSeg, 10), quote: newQuote.trim() }] });
              setNewQuote("");
            }}
          >
            Add evidence
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q,
  busy,
  onSubmit,
}: {
  q: LessonVersionDetail["questions"][number];
  busy: boolean;
  onSubmit: (qid: string, body: { answer?: string; dismiss: boolean }) => void;
}) {
  const [answer, setAnswer] = useState(q.answer);
  useEffect(() => setAnswer(q.answer), [q.answer]);
  return (
    <div className={`question-card q-${q.status}`}>
      <div className="q-head">
        <strong>{q.question}</strong>
        <span className={`chip status-chip s-${q.status}`}>{q.status}</span>
      </div>
      {q.why_missing && <div className="muted small">why flagged: {q.why_missing}</div>}
      {q.status === "open" ? (
        <>
          <textarea className="input" rows={2} placeholder="Ask the expert and record the answer here…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="btn-row">
            <button className="btn small-btn" disabled={busy || !answer.trim()} onClick={() => onSubmit(q.id, { answer, dismiss: false })}>
              Save answer
            </button>
            <button className="btn small-btn ghost" disabled={busy} onClick={() => onSubmit(q.id, { dismiss: true })}>
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <div className="q-answer">{q.status === "answered" ? q.answer : <em>dismissed — will stay visibly incomplete</em>}</div>
      )}
    </div>
  );
}
