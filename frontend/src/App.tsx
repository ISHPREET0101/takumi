import { useEffect, useState } from "react";
import { ArrowUpRight, AudioLines, BookOpen, ChevronRight, ClipboardCheck, FlaskConical, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { HealthInfo } from "./types";
import CapturePage from "./pages/CapturePage";
import ReviewPage from "./pages/ReviewPage";
import PracticePage from "./pages/PracticePage";
import ErrorBoundary from "./components/ErrorBoundary";
import { isDemoMode } from "./demo/demoShim";

type Page = "capture" | "review" | "practice";
function pageFromHash(): Page {
  const hash = window.location.hash.replace("#/", "");
  return hash === "review" || hash === "practice" ? hash : "capture";
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [reviewLessonId, setReviewLessonId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);

  const guardNavigation = (event: React.MouseEvent<HTMLAnchorElement>, destination: Page) => {
    if (page === "review" && destination !== "review" && reviewDirty && !window.confirm("Leave expert review and discard your unsaved lesson edits?")) event.preventDefault();
  };

  useEffect(() => {
    const onHash = () => { setPage(pageFromHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (document.hidden) return;
      void api.health().then((info) => { if (!cancelled) setHealth(info); }).catch(() => { if (!cancelled) setHealth(null); });
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="#/capture" aria-label="Takumi home" onClick={(event) => guardNavigation(event, "capture")}>
          <span className="brand-mark">匠</span>
          <div><div className="brand-name">Takumi<span>.</span></div><div className="brand-sub">THE KNOWLEDGE WORKSHOP</div></div>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="tabs" aria-label="Main navigation">
          {([
            ["capture", "Capture", AudioLines],
            ["review", "Expert review", ClipboardCheck],
            ["practice", "Practice", FlaskConical],
          ] as const).map(([id, label, Icon], index) => (
            <a key={id} href={`#/${id}`} className={`tab ${page === id ? "active" : ""}`} aria-current={page === id ? "page" : undefined} onClick={(event) => guardNavigation(event, id)}>
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span><span className="nav-index" aria-hidden="true">0{index + 1}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-note"><BookOpen size={22} strokeWidth={1.4} /><p>Good work deserves<br /><em>to be passed on.</em></p><span>EXPERTISE, KEPT IN PRACTICE.</span></div>
        <div className="sidebar-bottom"><ShieldCheck size={16} /><span>Expert approved. Always.</span></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">Workshop <ChevronRight size={14} /><span>{page === "review" ? "Expert review" : page === "practice" ? "Practice" : "Capture"}</span></div>
          <div className="health" title={health ? `Extraction: ${health.default_provider}` : "Start the local backend to reconnect"}>
            <span className={`dot ${health ? "ok" : "bad"}`} />
            <span>{isDemoMode ? "Sample workspace" : health ? "Local workspace" : "Backend unavailable"}</span>
          </div>
        </header>
        {isDemoMode && <div className="demo-notice"><span className="demo-label">DEMO</span><span>Sample lesson. Changes stay in this browser; uploads require the local app.</span><ArrowUpRight size={14} /></div>}
        <main id="main-content" tabIndex={-1}>
          <ErrorBoundary>
            {page === "capture" && <CapturePage onOpenReview={(id) => { setReviewLessonId(id); window.location.hash = "#/review"; }} />}
            {page === "review" && <ReviewPage initialLessonId={reviewLessonId} onDirtyChange={setReviewDirty} />}
            {page === "practice" && <PracticePage />}
          </ErrorBoundary>
        </main>
        <footer className="footer"><span>匠 TAKUMI <span className="footer-divider">/</span> Knowledge that lives in the doing.</span><span>JETRO-PS-03 <span className="footer-divider">/</span> Thapar Japan Hackathon</span></footer>
      </div>
    </div>
  );
}
