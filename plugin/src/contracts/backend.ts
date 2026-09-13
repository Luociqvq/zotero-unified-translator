import type { LanguageCode } from "./translation.js";

export type FullOutputMode = "bilingual" | "translated";
export type FullTaskState = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface FullTask {
  taskId: string;
  state: FullTaskState;
  progress: number;
  stage: string;
  originalFilename: string;
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  engine: string;
  engineVersion: string;
  outputMode: FullOutputMode;
  pageCount: number;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  retryable: boolean;
  canCancel: boolean;
  cancelRequested: boolean;
  attempts: number;
  downloadUrl?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface BackendHealth {
  status: "ok" | "degraded";
  service: string;
  apiVersion: string;
  workerMode: string;
  engine: {
    id: string;
    version: string;
    available: boolean;
    reason: string;
  } | null;
  engines: Array<{
    id: string;
    version: string;
    available: boolean;
    reason: string;
  }>;
  limits: {
    maxFileBytes: number;
    maxPages: number;
  };
  features: {
    polling: boolean;
    sse: boolean;
    cancel: boolean;
  };
}

export interface FullTaskOptions {
  sourceLanguage: LanguageCode;
  targetLanguage: Exclude<LanguageCode, "auto">;
  engine: string;
  outputMode: FullOutputMode;
  clientRequestId: string;
}
