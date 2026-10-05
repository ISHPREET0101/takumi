import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AttemptRecord, AttemptResult, LessonStep, ScopeSettings, TraineeLesson, TraineeLessonCard } from "../types";
import ProvenanceBadge from "../components/ProvenanceBadge";
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

  useEffect(() => {
    void api
      .traineeLessons()
      .then(setLessons)
      .catch((e) => setError(String(e)));
  }, []);

  const openLesson = async (id: string) => {
    setError(null);
    try {
      const l = await api.traineeLesson(id);
      setActive(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!active) {
    return (
      <div className="page">
        <section className="card">
          <h2>Practice</h2>
          <p className="muted">
            Only <strong>expert-approved</strong> lessons appear here. Practice assesses simulated decisions; physical
            competence still requires bench observation.
          </p>
          {error && <div className="banner error">{error}</div>}
          <div className="lesson-cards">
            {lessons.length === 0 && <p className="muted">No approved lessons yet — ask the expert to approve one in Review.</p>}
            {lessons.map((l) => (
              <div key={l.id} className="lesson-card" onClick={() => void openLesson(l.id)}>
                <strong>{l.title}</strong>
                <div className="muted small">{l.summary}</div>
                <div className="lesson-card-meta">
                  <span className="muted small">
                    v{l.version_number} · {l.step_count} steps
                  </span>
                  <ProvenanceBadge provenance={l.provenance} />
                </div>
              </div>
            ))}
          </div>
        </section>
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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [finished, setFinished] = useState(false);
  const [submitted, setSubmitted] = useState<AttemptResult | null>(null);
  const [pastAttempts, setPastAttempts] = useState<AttemptRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stepStartRef = useRef<number>(Date.now());
  const overallStartRef = useRef<number>(Date.now());

  const step = lesson.steps[stepIdx];
  const hasSim = !!step?.simulator;

  useEffect(() => {
    setSettings(initialSettingsFor(step));
    setWrong(0);
    setAssists(0);
    setFeedback(
      step?.simulator?.task === "recovery"
        ? { kind: "info", lines: ["A disturbance hit the scope: the trigger dropped out and the trace is drifting.", step.simulator?.note ?? ""].filter(Boolean) }
        : step?.simulator?.note
          ? { kind: "info", lines: [step.simulator.note] }
          : null,
    );
    stepStartRef.current = Date.now();
  }, [step]);

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
    if (!traineeName.trim()) return;
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
    }
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
        <section className="card">
          <h2>{lesson.title} — session complete</h2>
          <ProvenanceBadge provenance={lesson.provenance} />
          <p className="big-score">{clientScore}<span className="score-denom">/100</span></p>
          <table className="table">
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
          </table>
          {!submitted ? (
            <div className="row">
              <input
                className="input"
                style={{ maxWidth: 280 }}
                placeholder="Your name"
                value={traineeName}
                onChange={(e) => setTraineeName(e.target.value)}
              />
              <button className="btn primary" disabled={!traineeName.trim()} onClick={() => void submit()}>
                Submit attempt
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
                      {pastAttempts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.trainee_name}</td>
                          <td>{a.score}/100</td>
                          <td>{Math.round((a.duration_ms ?? 0) / 1000)}s</td>
                          <td>{new Date(a.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={onExit}>
              Back to lessons
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="card">
        <div className="row spread">
          <div>
            <h2 style={{ marginBottom: 4 }}>{lesson.title}</h2>
            <span className="muted small">
              v{lesson.version_number} · step {stepIdx + 1} of {lesson.steps.length}
            </span>
          </div>
          <div className="btn-row">
            <ProvenanceBadge provenance={lesson.provenance} />
            <button className="btn ghost" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
        <div className="step-rail">
          {lesson.steps.map((s, i) => {
            const done = results.find((r) => r.step_id === s.id);
            return (
              <div key={s.id} className={`rail-dot ${i === stepIdx ? "current" : ""} ${done ? (done.passed ? "ok" : "bad") : ""}`}>
                {i + 1}
              </div>
            );
          })}
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>

      <div className="practice-grid">
        <section className="card">
          <h3>
            Step {stepIdx + 1}: {step.title}
          </h3>
          <p className="instructions">{step.instructions}</p>
          {step.rationale && (
            <p className="muted small">
              <strong>Why:</strong> {step.rationale}
            </p>
          )}
          <div className="scope-wrap">
            <ScopeSimulator settings={settings} />
            <div className="scope-controls">
              <div className="ctrl-group">
                <span className="ctrl-label">VOLTS/DIV</span>
                <select className="select" value={settings.vdiv} onChange={(e) => patch({ vdiv: parseFloat(e.target.value) })}>
                  {VDIV_STEPS.map((v) => (
                    <option key={v} value={v}>
                      {formatVdiv(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ctrl-group">
                <span className="ctrl-label">TIME/DIV</span>
                <select className="select" value={settings.sdiv} onChange={(e) => patch({ sdiv: parseFloat(e.target.value) })}>
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
                <select className="select" value={settings.edge} onChange={(e) => patch({ edge: e.target.value as "rise" | "fall" })}>
                  <option value="rise">rising edge</option>
                  <option value="fall">falling edge</option>
                </select>
                <input
                  type="range"
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
          <h3>Expert guidance</h3>
          {feedback ? (
            <div className={`feedback fb-${feedback.kind}`}>
              {feedback.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          ) : (
            <p className="muted">Adjust the simulated scope to follow this step, then press <strong>Check this step</strong>. Feedback quotes the expert's own rationale, mistakes and recovery moves.</p>
          )}
          {hasSim && step.simulator?.task !== "free" && (
            <div className="btn-row">
              <button className="btn primary" onClick={check}>
                Check this step
              </button>
              <button className="btn ghost" onClick={askHint}>
                Ask the expert (hint)
              </button>
            </div>
          )}
          {(!hasSim || step.simulator?.task === "free") && (
            <div className="btn-row">
              <button className="btn primary" onClick={() => finishStep(true)}>
                Continue
              </button>
            </div>
          )}
          <div className="muted small" style={{ marginTop: 10 }}>
            This step: {wrong} wrong adjustment(s) · {assists} hint(s) used
          </div>
        </section>
      </div>
    </div>
  );
}
