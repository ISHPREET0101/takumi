import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Recording } from "../types";
import ProvenanceBadge from "../components/ProvenanceBadge";

const STAGE_LABEL: Record<string, string> = {
  uploading: "Upload received",
  transcribing: "Transcribing locally (faster-whisper)",
  extracting: "Extracting lesson structure",
  validating: "Validating structure & evidence references",
  finalizing: "Creating draft lesson",
  done: "Done",
};

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function CapturePage({ onOpenReview }: { onOpenReview: (lessonId: string) => void }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listRecordings();
      setRecordings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        await api.uploadRecording(file);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const anyActive = recordings.some((r) => r.job && (r.job.status === "queued" || r.job.status === "running"));

  return (
    <div className="page">
      <section className="card">
        <h2>Capture an expert demonstration</h2>
        <p className="muted">
          Upload an English demonstration video or audio of <strong>up to 10 minutes</strong>. Processing runs in the
          background: local transcription, then AI extraction into a draft lesson for expert review. The recording
          itself never leaves this machine; only the transcript goes to the extraction provider.
        </p>
        <div
          className={`dropzone ${dragOver ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <span>Uploading…</span>
          ) : (
            <>
              <strong>Drop a recording here</strong> or click to browse
              <div className="muted small">mp4 · mov · webm · m4a · mp3 · wav — max 1 GB</div>
            </>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="video/*,audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {error && <div className="banner error">{error}</div>}
        {anyActive && <div className="banner info">Processing in background — status updates automatically.</div>}
      </section>

      <section className="card">
        <h2>Recordings</h2>
        {recordings.length === 0 && <p className="muted">No recordings yet.</p>}
        <div className="rec-list">
          {recordings.map((r) => (
            <div key={r.id} className="rec-item">
              <div className="rec-main">
                <div className="rec-name">
                  {r.original_name}
                  {r.is_demo && <span className="chip demo-chip">bundled sample</span>}
                </div>
                <div className="muted small">
                  {r.media_kind} · {fmtBytes(r.size_bytes)} · uploaded {fmtTime(r.created_at)}
                  {r.duration_sec ? ` · ${Math.round(r.duration_sec)}s` : ""}
                  {r.segment_count > 0 ? ` · ${r.segment_count} transcript segments` : ""}
                </div>
                {r.job && (r.job.status === "queued" || r.job.status === "running") && (
                  <div className="progress-wrap">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${r.job.progress}%` }} />
                    </div>
                    <span className="small muted">
                      {STAGE_LABEL[r.job.stage ?? ""] ?? r.job.stage} — {Math.round(r.job.progress)}%
                    </span>
                  </div>
                )}
                {r.job?.status === "failed" && (
                  <div className="banner error small-banner">
                    Processing failed: {r.job.error}
                    <button className="btn small-btn" onClick={() => void api.reprocess(r.id).then(refresh)}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
              <div className="rec-actions">
                {r.job?.provider && (
                  <ProvenanceBadge
                    provenance={r.job.provider === "saved_demo" ? "saved_demo" : r.job.provider === "ollama" ? "local_ai" : "hosted_ai"}
                    provider={r.job.provider}
                    model={r.job.model}
                  />
                )}
                <a className="btn ghost" href={`/api/recordings/${r.id}/media`} target="_blank" rel="noreferrer">
                  Media
                </a>
                {r.lesson && (
                  <button className="btn primary" onClick={() => onOpenReview(r.lesson!.id)}>
                    Open lesson in Review
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
