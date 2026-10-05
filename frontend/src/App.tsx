import { useEffect, useState } from "react";
import { api } from "./api";
import type { HealthInfo } from "./types";
import CapturePage from "./pages/CapturePage";
import ReviewPage from "./pages/ReviewPage";
import PracticePage from "./pages/PracticePage";
import ErrorBoundary from "./components/ErrorBoundary";

type Page = "capture" | "review" | "practice";

function pageFromHash(): Page {
  const h = window.location.hash.replace("#/", "");
  return h === "review" || h === "practice" ? (h as Page) : "capture";
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [reviewLessonId, setReviewLessonId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void api.health().then(setHealth).catch(() => undefined);
  }, [page]);

  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
  };

  const providerLine = health
    ? `provider: ${health.default_provider}` +
      (health.providers.nvidia.enabled ? " · NVIDIA NIM enabled" : "") +
      (health.providers.ollama.reachable ? " · Ollama reachable" : "") +
      (health.whisper_available ? ` · whisper ${health.whisper_model} ready` : " · whisper unavailable")
    : "backend offline";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">匠</span>
          <div>
            <div className="brand-name">Takumi</div>
            <div className="brand-sub">expert knowledge capture &amp; guided apprenticeship</div>
          </div>
        </div>
        <nav className="tabs">
          <button className={`tab ${page === "capture" ? "active" : ""}`} onClick={() => go("capture")}>
            Capture
          </button>
          <button className={`tab ${page === "review" ? "active" : ""}`} onClick={() => go("review")}>
            Review
          </button>
          <button className={`tab ${page === "practice" ? "active" : ""}`} onClick={() => go("practice")}>
            Practice
          </button>
        </nav>
        <div className="health" title={providerLine}>
          <span className={`dot ${health ? "ok" : "bad"}`} />
          <span className="health-text">{providerLine}</span>
        </div>
      </header>

      <main>
        <ErrorBoundary>
          {page === "capture" && <CapturePage onOpenReview={(id) => { setReviewLessonId(id); go("review"); }} />}
          {page === "review" && <ReviewPage initialLessonId={reviewLessonId} />}
          {page === "practice" && <PracticePage />}
        </ErrorBoundary>
      </main>

      <footer className="footer">
        Thapar Japan Hackathon — JETRO-PS-03 · Preserving &amp; transferring tacit technical expertise. Only approved
        lessons reach trainees; recordings stay local; transcript-only data goes to the configured extraction provider.
      </footer>
    </div>
  );
}
