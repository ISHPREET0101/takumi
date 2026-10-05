import type {
  AttemptRecord,
  AttemptResult,
  HealthInfo,
  LessonDetail,
  LessonSummary,
  LessonVersionDetail,
  Recording,
  TranscriptSegment,
  TraineeLesson,
  TraineeLessonCard,
} from "./types";

const BASE = "/api";

class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail: unknown = null;
    let message = `${res.status} ${res.statusText}`;
    try {
      detail = await res.json();
      const d = detail as { detail?: unknown };
      if (typeof d.detail === "string") message = d.detail;
      else if (d.detail && typeof d.detail === "object") message = JSON.stringify(d.detail);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthInfo>("/health"),

  uploadRecording: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Recording>("/recordings", { method: "POST", body: form });
  },
  listRecordings: () => request<Recording[]>("/recordings"),
  getRecording: (id: string) => request<Recording & { transcript: TranscriptSegment[] }>(`/recordings/${id}`),
  reprocess: (id: string) => request<{ job_id: string }>(`/recordings/${id}/reprocess`, { method: "POST" }),
  editSegment: (recordingId: string, seg: number, text: string) =>
    request<TranscriptSegment>(`/recordings/${recordingId}/transcript/${seg}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }),
  mediaUrl: (recordingId: string) => `${BASE}/recordings/${recordingId}/media`,

  listLessons: () => request<LessonSummary[]>("/lessons"),
  getLesson: (id: string) => request<LessonDetail>(`/lessons/${id}`),
  getVersion: (id: string) => request<LessonVersionDetail>(`/lesson-versions/${id}`),
  updateVersion: (
    id: string,
    body: { title: string; summary: string; steps: unknown[]; questions: unknown[]; changelog?: string },
  ) => request<{ id: string; status: string }>(`/lesson-versions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  answerQuestion: (versionId: string, questionId: string, body: { answer?: string; dismiss: boolean }) =>
    request<{ id: string; status: string; answer: string }>(
      `/lesson-versions/${versionId}/questions/${questionId}`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  approveVersion: (versionId: string) =>
    request<{ id: string; status: string; approved_at: string }>(
      `/lesson-versions/${versionId}/approve`,
      { method: "POST" },
    ),
  lessonAttempts: (lessonId: string) => request<AttemptRecord[]>(`/lessons/${lessonId}/attempts`),

  traineeLessons: () => request<TraineeLessonCard[]>("/trainee/lessons"),
  traineeLesson: (id: string) => request<TraineeLesson>(`/trainee/lessons/${id}`),
  submitAttempt: (lessonId: string, body: { trainee_name: string; duration_ms: number; steps: unknown[] }) =>
    request<AttemptResult>(`/trainee/lessons/${lessonId}/attempts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  myAttempts: (lessonId: string, trainee?: string) =>
    request<AttemptRecord[]>(
      `/trainee/lessons/${lessonId}/attempts${trainee ? `?trainee=${encodeURIComponent(trainee)}` : ""}`,
    ),
};

export { ApiError };
