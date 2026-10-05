export interface TranscriptSegment {
  seg: number;
  start: number;
  end: number;
  text: string;
  edited_text: string | null;
}

export interface JobInfo {
  id: string;
  recording_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string | null;
  progress: number;
  error: string | null;
  provider: string | null;
  model: string | null;
  lesson_id: string | null;
}

export interface Recording {
  id: string;
  original_name: string;
  media_kind: "video" | "audio";
  size_bytes: number;
  duration_sec: number | null;
  is_demo: boolean;
  created_at: string;
  segment_count: number;
  lesson: { id: string; title: string } | null;
  job: JobInfo | null;
}

export interface Evidence {
  seg: number;
  quote: string;
}

export type SimTaskName = "vertical" | "timebase" | "trigger" | "recovery" | "free";

export interface SimulatorTask {
  task: SimTaskName;
  target_vdiv?: number;
  target_sdiv?: number;
  target_level?: number;
  edge?: "rise" | "fall";
  initial?: Partial<ScopeSettings>;
  note?: string;
}

export interface LessonStep {
  id: string;
  title: string;
  instructions: string;
  rationale: string;
  success_cues: string[];
  common_mistakes: string[];
  recovery: string;
  evidence: Evidence[];
  simulator?: SimulatorTask | null;
}

export interface LessonQuestion {
  id: string;
  question: string;
  why_missing: string;
  answer: string;
  status: "open" | "answered" | "dismissed";
}

export type Provenance = "hosted_ai" | "local_ai" | "saved_demo";

export interface VersionSummary {
  id: string;
  lesson_id: string;
  version_number: number;
  title: string;
  status: "draft" | "approved";
  provenance: Provenance;
  provider: string | null;
  model: string | null;
  cached: boolean;
  created_at: string;
  approved_at: string | null;
  changelog: string | null;
}

export interface LessonVersionDetail extends VersionSummary {
  summary: string;
  steps: LessonStep[];
  questions: LessonQuestion[];
  lesson?: { id: string; recording_id: string | null; approved_version_id: string | null };
  transcript: TranscriptSegment[];
}

export interface LessonSummary {
  id: string;
  recording_id: string | null;
  title: string;
  created_at: string;
  approved_version_id: string | null;
  current_version: VersionSummary | null;
}

export interface LessonDetail {
  id: string;
  recording_id: string | null;
  title: string;
  created_at: string;
  approved_version_id: string | null;
  current_version_id: string | null;
  versions: VersionSummary[];
  transcript: TranscriptSegment[];
  attempts: AttemptRecord[];
  recording?: { id: string; original_name: string; media_kind: "video" | "audio"; is_demo: boolean } | null;
}

export interface AttemptRecord {
  id: string;
  trainee_name: string;
  score: number;
  duration_ms: number;
  created_at: string;
  lesson_version_id?: string;
  details?: { steps: AttemptStep[] };
}

export interface AttemptStep {
  step_id: string;
  title: string;
  passed: boolean;
  wrong_adjustments: number;
  assists: number;
  time_ms: number;
}

export interface AttemptResult {
  id: string;
  score: number;
  lesson_version_id: string;
  stored: boolean;
}

export interface TraineeLessonCard {
  id: string;
  title: string;
  summary: string;
  version_number: number;
  provenance: Provenance;
  step_count: number;
}

export interface TraineeLesson {
  id: string;
  version_number: number;
  title: string;
  summary: string;
  steps: LessonStep[];
  provenance: Provenance;
  recording: { id: string; original_name: string; media_kind: string; is_demo: boolean } | null;
}

export interface ScopeSettings {
  vdiv: number;
  sdiv: number;
  trigEnabled: boolean;
  trigLevel: number;
  edge: "rise" | "fall";
  running: boolean;
}

export interface HealthInfo {
  status: string;
  app: string;
  whisper_available: boolean;
  whisper_model: string;
  default_provider: string;
  providers: {
    nvidia: { enabled: boolean; key_present: boolean; model: string; base_url: string; note: string };
            ollama: { reachable: boolean | null; model: string; base_url: string };
    saved_demo: { available: boolean };
  };
}
