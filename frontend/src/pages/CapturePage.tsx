import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, AudioLines, Check, FileVideo, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { api } from "../api";
import type { Recording } from "../types";
import ProvenanceBadge from "../components/ProvenanceBadge";
import { isDemoMode } from "../demo/demoShim";

const STAGE_LABEL: Record<string, string> = {
  uploading: "Upload received", transcribing: "Transcribing recording", extracting: "Drafting lesson",
  validating: "Checking evidence", finalizing: "Preparing draft", done: "Ready for review",
};
const activeJob = (r: Recording) => r.job?.status === "queued" || r.job?.status === "running";
function fmtBytes(n: number): string { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`; }

export default function CapturePage({ onOpenReview }: { onOpenReview: (lessonId: string) => void }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const requestLock = useRef(false);
  const anyActive = recordings.some(activeJob);

  const refresh = useCallback(async () => {
    if (requestLock.current) return;
    requestLock.current = true;
    try {
      const next = await api.listRecordings();
      setRecordings(next);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { requestLock.current = false; setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const poll = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(poll, anyActive ? 1500 : 15000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, anyActive]);

  const upload = async (file: File) => {
    if (isDemoMode || uploadLock.current) return;
    if (!/\.(mp4|mov|webm|mkv|m4a|mp3|wav|ogg|flac)$/i.test(file.name)) { setError("Choose a supported audio or video recording."); return; }
    if (file.size > 1000 * 1024 * 1024) { setError("This recording exceeds the 1 GB upload limit."); return; }
    uploadLock.current = true;
    setError(null); setUploading(true);
    try { await api.uploadRecording(file); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { uploadLock.current = false; setUploading(false); }
  };

  const retry = async (id: string) => {
    try { await api.reprocess(id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="page capture-page">
      <header className="page-heading"><div><div className="eyebrow"><span className="red-rule" />01 / THE SOURCE</div><h1>Keep the know-how.</h1><p>The small decisions. The practiced hand. Start with a recording.</p></div><span className="heading-note">FROM ONE EXPERT<br />TO THE NEXT GENERATION</span></header>
      <section className="capture-intro" aria-label="New recording">
        <div className="capture-upload">
          <div className="section-heading"><span className="section-number">01</span><h2>Capture a demonstration</h2></div>
          <p className="muted">An expert, a task, and the reasoning behind it.<br /> English audio or video, up to 10 minutes.</p>
          <button type="button" className={`dropzone ${dragOver ? "drag" : ""}`} disabled={uploading || isDemoMode}
            onDragOver={(e) => { e.preventDefault(); if (!uploading && !isDemoMode) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files?.[0]; if (file) void upload(file); }}
            onClick={() => fileInput.current?.click()}>
            {uploading ? <LoaderCircle className="spin" size={26} /> : <Upload size={26} strokeWidth={1.5} />}
            <strong>{uploading ? "Uploading recording..." : isDemoMode ? "Capture in the local app" : "Drop your recording here"}</strong>
            <span>{isDemoMode ? "Explore the sample recording below" : "or browse files"}</span>
            <span className="file-formats">MP4, MOV, WEBM, MKV / AUDIO · MAX 1 GB</span>
          </button>
          <input ref={fileInput} type="file" accept=".mp4,.mov,.webm,.mkv,.m4a,.mp3,.wav,.ogg,.flac" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
          <div className="privacy-note"><ShieldCheck size={17} /><span>Recordings stay on this machine. Only the transcript goes to your selected extraction provider.</span></div>
        </div>
      </section>
      <div className="workflow-strip" aria-label="Lesson workflow">{[["Record", "Keep the demonstration"], ["Review", "Let the expert decide"], ["Practice", "Put knowledge to work"]].map(([title, detail], i) => <div key={title}><span className="workflow-number">0{i + 1}</span><span><strong>{title}</strong><small>{detail}</small></span>{i < 2 && <ArrowRight size={17} />}</div>)}</div>
      <section className="recordings-section">
        <div className="section-heading spread"><div className="row"><span className="section-number">02</span><h2>Recording register</h2><span className="count">{recordings.length.toString().padStart(2, "0")}</span></div><button className="btn icon-btn ghost" aria-label="Refresh recordings" title="Refresh recordings" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
        {error && <div className="banner error" role="alert">{error}</div>}
        {loading && <div className="empty-state" role="status"><LoaderCircle className="spin" size={22} />Loading recordings...</div>}
        {!loading && recordings.length === 0 && <div className="empty-state"><AudioLines size={28} /><strong>The first recording starts here.</strong><span>Upload a demonstration to create a lesson draft.</span></div>}
        <div className="rec-list">{recordings.map((r, i) => <article key={r.id} className="rec-item">
          <span className="record-index">{String(i + 1).padStart(2, "0")}</span><div className="record-icon">{r.media_kind === "video" ? <FileVideo size={23} /> : <AudioLines size={23} />}</div>
          <div className="rec-main"><div className="rec-name">{r.lesson?.title ?? r.original_name}{r.is_demo && <span className="chip demo-chip">SAMPLE</span>}</div><div className="muted small">{r.original_name} · {fmtBytes(r.size_bytes)}{r.duration_sec ? ` · ${Math.round(r.duration_sec)} sec` : ""}{r.segment_count > 0 ? ` · ${r.segment_count} segments` : ""}</div>
            {activeJob(r) && r.job && <div className="progress-wrap" role="status"><div className="progress-bar" role="progressbar" aria-label="Recording processing" aria-valuenow={Math.round(r.job.progress)} aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{ width: `${r.job.progress}%` }} /></div><span className="small muted">{STAGE_LABEL[r.job.stage ?? ""] ?? "Processing"} · {Math.round(r.job.progress)}%</span></div>}
            {r.job?.status === "failed" && <div className="banner error small-banner">{r.job.error}<button className="btn small-btn" onClick={() => void retry(r.id)}><RefreshCw size={13} />Retry</button></div>}
          </div>
          <div className="rec-actions">{r.lesson && <span className="record-ready"><Check size={14} />Draft ready</span>}{!isDemoMode && <a className="btn ghost" href={api.mediaUrl(r.id)} target="_blank" rel="noreferrer">Media</a>}{r.lesson && <button className="btn" onClick={() => onOpenReview(r.lesson!.id)}>Review lesson<ArrowRight size={16} /></button>}</div>
          {r.job?.provider && <div className="record-provenance"><ProvenanceBadge provenance={r.job.provider === "saved_demo" ? "saved_demo" : r.job.provider === "ollama" ? "local_ai" : "hosted_ai"} /></div>}
        </article>)}</div>
      </section>
    </div>
  );
}
