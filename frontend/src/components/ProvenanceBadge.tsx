import type { Provenance } from "../types";

const LABELS: Record<Provenance, { label: string; className: string; title: string }> = {
  hosted_ai: {
    label: "Hosted AI",
    className: "prov-hosted",
    title: "Lesson extracted by a hosted AI provider (NVIDIA NIM)",
  },
  local_ai: {
    label: "Local AI",
    className: "prov-local",
    title: "Lesson extracted by a local model (Ollama)",
  },
  saved_demo: {
    label: "Saved demonstration",
    className: "prov-demo",
    title: "Offline bundled sample — no AI call was made",
  },
};

export default function ProvenanceBadge({
  provenance,
  provider,
  model,
  cached,
}: {
  provenance: Provenance | undefined;
  provider?: string | null;
  model?: string | null;
  cached?: boolean;
}) {
  if (!provenance) return null;
  const meta = LABELS[provenance] ?? LABELS.saved_demo;
  // NVIDIA model ids already carry their org prefix ("nvidia/nemotron…") —
  // don't repeat the provider name in front of it.
  const modelDetail = model?.startsWith(`${provider}/`) ? model : [provider, model].filter(Boolean).join("/");
  const suffix = cached ? " (cached)" : "";
  const detail = modelDetail ? ` · ${modelDetail}` : "";
  return (
    <span className={`prov-badge ${meta.className}`} title={meta.title}>
      {meta.label}
      {suffix}
      <span className="prov-detail">{detail}</span>
    </span>
  );
}
