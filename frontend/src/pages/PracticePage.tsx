import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AttemptRecord, AttemptResult, LessonStep, ScopeSettings, TraineeLesson, TraineeLessonCard } from "../types";
import ProvenanceBadge from "../components/ProvenanceBadge";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, Lightbulb, LoaderCircle, RotateCcw } from "lucide-react";
import ScopeSimulator, { DEFAULT_SETTINGS, PEAK_V, SDIV_STEPS, VDIV_STEPS, formatSdiv, formatVdiv } from "../components/ScopeSimulator";

interface StepResult extends Record<string, unknown> {
  step_id: string;
  title: string;
  passed: boolean;
  wrong_adjustments: number;
  assists: number;
  time_ms: number;
}

interface Feedback {
  kind: "pass" | "fail" | "hint" | "info";
  lines: string[];
}

function initialSettingsFor(step: LessonStep): ScopeSettings {
  const init = step.simulator?.initial ?? {};
  return {
    vdiv: init.vdiv ?? DEFAULT_SETTINGS.vdiv,
    sdiv: init.sdiv ?? DEFAULT_SETTINGS.sdiv,
    trigEnabled: init.trigEnabled ?? DEFAULT_SETTINGS.trigEnabled,
    trigLevel: init.trigLevel ?? DEFAULT_SETTINGS.trigLevel,
    edge: init.edge ?? DEFAULT_SETTINGS.edge,
    running: true,
  };
}

function initialFeedbackFor(step: LessonStep): Feedback | null {
  if (step.simulator?.task === "recovery") return { kind: "info", lines: ["A disturbance hit the scope: the trigger dropped out and the trace is drifting.", step.simulator.note ?? ""].filter(Boolean) };
  return step.simulator?.note ? { kind: "info", lines: [step.simulator.note] } : null;
}

function checkStep(step: LessonStep, s: ScopeSettings): boolean {
  const sim = step.simulator;
  if (!sim) return true;
  switch (sim.task) {
    case "vertical":
      return Math.abs(s.vdiv - (sim.target_vdiv ?? s.vdiv)) < 1e-9;
    case "timebase":
      return Math.abs(s.sdiv - (sim.target_sdiv ?? s.sdiv)) < 1e-9;
    case "trigger":
    case "recovery": {
      const levelOk = Math.abs(s.trigLevel - (sim.target_level ?? s.trigLevel)) <= 0.15;
      const edgeOk = !sim.edge || s.edge === sim.edge;
      const crossing = s.trigLevel > -PEAK_V && s.trigLevel < PEAK_V;
      return s.trigEnabled && levelOk && edgeOk && crossing;
    }
    default:
      return true;
  }
}

function fmtMs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

export default function PracticePage() {
  const [lessons, setLessons] = useState<TraineeLessonCard[]>([]);
  const [active, setActive] = useState<TraineeLesson | null>(null);
  const [traineeName, setTraineeName] = useState(() => localStorage.getItem("takumi_trainee") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    void api
      .traineeLessons()
      .then(setLessons)
      .catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);

  const openLesson = async (id: string) => {
    if (opening) return;
    setOpening(id);
    setError(null);
    try {
      const l = await api.traineeLesson(id);
      setActive(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setOpening(null); }
  };

  if (!active) {
    return (
      <div className="page">
        <header className="page-heading"><div><div className="eyebrow"><span className="red-rule" />03 / AT THE BENCH</div><h1>Learn by doing.</h1><p>Expert-approved lessons. Real reasoning. Room to get it wrong.</p></div><span className="heading-note">PRACTICE THE DECISION<br />THEN TAKE IT TO THE BENCH</span></header>
        <section className="library-section">
          <div className="section-heading"><span className="section-number">01</span><h2>On the workbench</h2><span className="count">{lessons.length.toString().padStart(2, "0")}</span></div>
          {error && <div className="banner error" role="alert">{error}</div>}
          {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" size={24} />Loading lessons...</div>}
          <div className="lesson-cards">
            {!loading && lessons.length === 0 && <div className="empty-state"><BookOpen size={28} /><strong>Good lessons start with a second look.</strong><span>No approved lessons yet. An expert needs to finish review first.</span><a className="btn" href="#/review">Go to expert review<ArrowRight size={15} /></a></div>}
            {lessons.map((l) => (
              <button key={l.id} className="lesson-card" disabled={!!opening} onClick={() => void openLesson(l.id)}>
                <img className="lesson-art" src="/images/workshop.webp" alt="Illustrative oscilloscope workbench" width="768" height="512" loading="lazy" />
                <span className="lesson-card-body"><span className="eyebrow"><CheckCheck size={13} />EXPERT APPROVED / V{l.version_number}</span>
                <strong>{l.title}</strong>
                <span className="muted small">{l.summary}</span>
                <span className="lesson-card-meta">
                  <span className="muted small">
                    {l.step_count} steps
                  </span>
                  <ProvenanceBadge provenance={l.provenance} />
                </span><span className="lesson-enter" style={{ marginTop: 18 }}>{opening === l.id ? "Opening..." : "Begin practice"}<ArrowRight size={17} /></span></span>
              </button>
            ))}
          </div>
        </section><p className="muted small">Simulated decisions are assessed here. Physical competence requires observation at the bench.</p>
      </div>
    );
  }

  return <LessonRunner lesson={active} traineeName={traineeName} setTraineeName={setTraineeName} onExit={() => setActive(null)} />;
}

function LessonRunner({
  lesson,
  traineeName,
  setTraineeName,
  onExit,
}: {
  lesson: TraineeLesson;
  traineeName: string;
  setTraineeName: (n: string) => void;
  onExit: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [settings, setSettings] = useState<ScopeSettings>(() => initialSettingsFor(lesson.steps[0]));
  const [wrong, setWrong] = useState(0);
  const [assists, setAssists] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(() => initialFeedbackFor(lesson.steps[0]));
  const [results, setResults] = useState<StepResult[]>([]);
  const [finished, setFinished] = useState(false);
  const [submitted, setSubmitted] = useState<AttemptResult | null>(null);
  const [pastAttempts, setPastAttempts] = useState<AttemptRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const stepStartRef = useRef<number>(Date.now());
  const overallStartRef = useRef<number>(Date.now());

  const step = lesson.steps[stepIdx];
  const hasSim = !!step?.simulator;

  const patch = (p: Partial<ScopeSettings>) => setSettings((s) => ({ ...s, ...p }));

  const finishStep = (passed: boolean) => {
    const rec: StepResult = {
      step_id: step.id,
      title: step.title,
      passed,
      wrong_adjustments: wrong,
      assists,
      time_ms: Date.now() - stepStartRef.current,
    };
    setResults((prev) => [...prev, rec]);
    if (stepIdx + 1 < lesson.steps.length) {
      const next = lesson.steps[stepIdx + 1];
      setSettings(initialSettingsFor(next));
      setFeedback(initialFeedbackFor(next));
      setWrong(0);
      setAssists(0);
      stepStartRef.current = Date.now();
      setStepIdx(stepIdx + 1);
    } else {
      setFinished(true);
    }
  };

  const check = () => {
    if (!step.simulator) return;
    if (checkStep(step, settings)) {
      setFeedback({
        kind: "pass",
        lines: [
          "Correct — " + (step.success_cues[0] ?? "the scope behaves as the expert described."),
          ...step.success_cues.slice(1).map((c) => `Success cue: ${c}`),
          step.rationale ? `Why (expert): ${step.rationale}` : "",
        ].filter(Boolean),
      });
      finishStep(true);
    } else {
      const mistake = step.common_mistakes[(wrong) % Math.max(1, step.common_mistakes.length)];
      setWrong((w) => w + 1);
      setFeedback({
        kind: "fail",
        lines: [
          "Not yet — " + (mistake ?? "check the setting against the expert's instructions."),
          wrong + 1 >= 2 && step.recovery ? `Recovery: ${step.recovery}` : "Try again — adjust the controls and re-check.",
        ].filter(Boolean),
      });
    }
  };

  const askHint = () => {
    setAssists((a) => a + 1);
    setFeedback({
      kind: "hint",
      lines: [step.recovery ? `Expert recovery: ${step.recovery}` : `Expert rationale: ${step.rationale}`].filter(Boolean),
    });
  };

  const submit = async () => {
    if (!traineeName.trim() || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    localStorage.setItem("takumi_trainee", traineeName.trim());
    try {
      const res = await api.submitAttempt(lesson.id, {
        trainee_name: traineeName.trim(),
        duration_ms: Date.now() - overallStartRef.current,
        steps: results,
      });
      setSubmitted(res);
      setPastAttempts(await api.myAttempts(lesson.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const clientScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (100 * results.reduce((acc, r) => acc + (r.passed ? Math.max(0, 1 - 0.25 * r.wrong_adjustments - 0.15 * r.assists) : 0), 0)) /
          Math.max(1, results.length),
      ),
    ),
  );

  if (finished) {
    return (
      <div className="page">
        <header className="page-heading"><div><div className="eyebrow"><span className="red-rule" />PRACTICE / SESSION COMPLETE</div><h1>A little more know-how.</h1><p>{lesson.title}</p></div><CheckCheck size={34} color="var(--green)" /></header>
        <section className="result-section">
          <ProvenanceBadge provenance={lesson.provenance} />
          {error && <div className="banner error" role="alert">{error}</div>}
          <p className="big-score">{clientScore}<span className="score-denom">/100</span></p>
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Result</th>
                <th>Wrong adjustments</th>
                <th>Hints used</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.step_id}>
                  <td>{r.title}</td>
                  <td>{r.passed ? "✓ passed" : "✗ not completed"}</td>
                  <td>{r.wrong_adjustments}</td>
                  <td>{r.assists}</td>
                  <td>{fmtMs(r.time_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!submitted ? (
            <div className="row">
              <input
                className="input"
                style={{ maxWidth: 280 }}
                placeholder="Your name"
                aria-label="Trainee name"
                value={traineeName}
                onChange={(e) => setTraineeName(e.target.value)}
              />
              <button className="btn primary" disabled={!traineeName.trim() || submitting} onClick={() => void submit()}>
                {submitting ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}{submitting ? "Saving..." : "Save attempt"}
              </button>
            </div>
          ) : (
            <>
              <div className="banner ok">
                Attempt stored (id {submitted.id.slice(0, 8)}…) — score {submitted.score}/100, tied to approved version
                v{lesson.version_number}.
              </div>
              {pastAttempts.length > 0 && (
                <>
                  <h3>All attempts on this lesson ({pastAttempts.length})</h3>
                  <div className="table-wrap"><table className="table">
                    <thead>
                      <tr>
                        <th>Trainee</th>
                        <th>Score</th>
                        <th>Duration</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pastAttempts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.trainee_name}</td>
                          <td>{a.score}/100</td>
                          <td>{Math.round((a.duration_ms ?? 0) / 1000)}s</td>
                          <td>{new Date(a.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </>
              )}
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={onExit}>
              <ArrowLeft size={15} />Back to lessons
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="practice-header">
        <div className="row spread">
          <div>
            <div className="eyebrow"><span className="red-rule" />03 / GUIDED PRACTICE</div><h1 style={{ marginBottom: 8, fontFamily: "Georgia, serif", fontWeight: 400 }}>{lesson.title}</h1>
            <span className="muted small">
              v{lesson.version_number} · step {stepIdx + 1} of {lesson.steps.length}
            </span>
          </div>
          <div className="btn-row">
            <ProvenanceBadge provenance={lesson.provenance} />
            <button className="btn ghost" onClick={onExit}>
              <ArrowLeft size={14} />All lessons
            </button>
          </div>
        </div>
        <div className="step-rail" style={{ "--step-count": lesson.steps.length } as React.CSSProperties} aria-label="Lesson progress">
          {lesson.steps.map((s, i) => {
            const done = results.find((r) => r.step_id === s.id);
            return (
              <div key={s.id} className={`rail-step ${i === stepIdx ? "current" : ""} ${done ? (done.passed ? "ok" : "bad") : ""}`} aria-current={i === stepIdx ? "step" : undefined}>
                <span className="rail-dot">{done?.passed ? <Check size={12} /> : String(i + 1).padStart(2, "0")}</span><span className="rail-title">{s.title}</span>
              </div>
            );
          })}
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>

      <div className="practice-grid">
        <section className="card">
          <div className="eyebrow">THE TASK / STEP {String(stepIdx + 1).padStart(2, "0")}</div><h2>{step.title}</h2>
          <p className="instructions">{step.instructions}</p>
          <div className="scope-wrap">
            <div className="instrument-heading"><span>TAKUMI / DIGITAL OSCILLOSCOPE</span><span>CH 1 · 1 kHz · 2 Vpp</span></div>
            <ScopeSimulator settings={settings} />
            <div className="scope-controls">
              <div className="ctrl-group">
                <span className="ctrl-label">VOLTS/DIV</span>
                <select className="select" aria-label="Volts per division" value={settings.vdiv} onChange={(e) => patch({ vdiv: parseFloat(e.target.value) })}>
                  {VDIV_STEPS.map((v) => (
                    <option key={v} value={v}>
                      {formatVdiv(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ctrl-group">
                <span className="ctrl-label">TIME/DIV</span>
                <select className="select" aria-label="Time per division" value={settings.sdiv} onChange={(e) => patch({ sdiv: parseFloat(e.target.value) })}>
                  {SDIV_STEPS.map((v) => (
                    <option key={v} value={v}>
                      {formatSdiv(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ctrl-group">
                <span className="ctrl-label">Trigger</span>
                <label className="toggle">
                  <input type="checkbox" checked={settings.trigEnabled} onChange={(e) => patch({ trigEnabled: e.target.checked })} />
                  enabled
                </label>
                <select className="select" aria-label="Trigger edge" value={settings.edge} onChange={(e) => patch({ edge: e.target.value as "rise" | "fall" })}>
                  <option value="rise">rising edge</option>
                  <option value="fall">falling edge</option>
                </select>
                <input
                  type="range"
                  aria-label="Trigger level"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={settings.trigLevel}
                  onChange={(e) => patch({ trigLevel: parseFloat(e.target.value) })}
                />
                <span className="ctrl-value">{settings.trigLevel.toFixed(2)} V</span>
              </div>
              <div className="ctrl-group">
                <span className="ctrl-label">Run</span>
                <label className="toggle">
                  <input type="checkbox" checked={settings.running} onChange={(e) => patch({ running: e.target.checked })} />
                  running
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="eyebrow">FROM THE EXPERT</div><h2 className="guidance-heading"><BookOpen size={19} />The reasoning behind it.</h2>
          {step.rationale && <blockquote className="expert-quote">{step.rationale}<small>EXPERT'S RATIONALE / APPROVED V{lesson.version_number}</small></blockquote>}
          {feedback ? (
            <div className={`feedback fb-${feedback.kind}`} role="status" aria-live="polite">
              {feedback.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          ) : (
            <p className="muted small">{step.success_cues[0] ?? "Follow the expert's instructions for this step."}</p>
          )}
          {hasSim && step.simulator?.task !== "free" && (
            <div className="btn-row">
              <button className="btn primary" onClick={check}>
                <Check size={15} />Check this step
              </button>
              <button className="btn ghost" onClick={askHint}>
                <Lightbulb size={15} />Expert hint
              </button>
            </div>
          )}
          {(!hasSim || step.simulator?.task === "free") && (
            <div className="btn-row">
              <button className="btn primary" onClick={() => finishStep(true)}>
                Continue<ArrowRight size={15} />
              </button>
            </div>
          )}
          <div className="session-stats"><span><strong>{wrong.toString().padStart(2, "0")}</strong>Wrong adjustments</span><span><strong>{assists.toString().padStart(2, "0")}</strong>Hints used</span></div>
          <button className="btn ghost small-btn" style={{ marginTop: 18 }} onClick={() => setSettings(initialSettingsFor(step))}><RotateCcw size={13} />Reset instrument</button>
        </section>
      </div>
    </div>
  );
}
