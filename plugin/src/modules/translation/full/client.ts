import type {
  BackendHealth,
  FullTask,
  FullTaskOptions,
} from "../../../contracts/backend.js";
import { requestJson } from "../../utils/http.js";

export class FullTranslationTaskError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FullTranslationTaskError";
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function errorMessage(task: FullTask): string {
  return task.error?.message || "整篇 PDF 翻译失败";
}

export class FullTranslationClient {
  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

  private headers(): HeadersInit {
    return this.token ? { Authorization: "Bearer " + this.token } : {};
  }

  async health(signal?: AbortSignal): Promise<BackendHealth> {
    return requestJson<BackendHealth>(this.endpoint + "/api/v1/health", {
      signal,
      headers: this.headers(),
    });
  }

  async createTask(file: Blob, filename: string, options: FullTaskOptions): Promise<FullTask> {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("sourceLanguage", options.sourceLanguage);
    form.append("targetLanguage", options.targetLanguage);
    form.append("engine", options.engine);
    form.append("outputMode", options.outputMode);
    form.append("clientRequestId", options.clientRequestId);
    return requestJson<FullTask>(this.endpoint + "/api/v1/tasks", {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
  }

  async getTask(taskId: string): Promise<FullTask> {
    return requestJson<FullTask>(
      this.endpoint + "/api/v1/tasks/" + encodeURIComponent(taskId),
      { headers: this.headers() },
    );
  }

  async waitForCompletion(
    initialTask: FullTask,
    onProgress?: (task: FullTask) => void,
    signal?: AbortSignal,
  ): Promise<FullTask> {
    const startedAt = Date.now();
    let task = initialTask;
    onProgress?.(task);
    while (task.state === "queued" || task.state === "processing") {
      await wait(Date.now() - startedAt < 30_000 ? 1_000 : 3_000, signal);
      task = await this.getTask(task.taskId);
      onProgress?.(task);
    }
    if (task.state === "completed") {
      return task;
    }
    if (task.state === "cancelled") {
      throw new FullTranslationTaskError(
        "整篇 PDF 翻译已取消",
        "TASK_CANCELLED",
        false,
      );
    }
    throw new FullTranslationTaskError(
      errorMessage(task),
      task.error?.code ?? "TASK_FAILED",
      task.error?.retryable ?? false,
    );
  }

  async cancelTask(taskId: string): Promise<FullTask> {
    return requestJson<FullTask>(
      this.endpoint + "/api/v1/tasks/" + encodeURIComponent(taskId) + "/cancel",
      {
        method: "POST",
        headers: this.headers(),
      },
    );
  }

  async download(task: FullTask): Promise<Blob> {
    if (!task.downloadUrl) {
      throw new Error("task has no download URL");
    }
    const downloadURL = new URL(task.downloadUrl, this.endpoint);
    if (downloadURL.origin !== new URL(this.endpoint).origin) {
      throw new Error("后端返回了不同来源的下载地址，已阻止发送访问令牌");
    }
    const response = await fetch(downloadURL, {
      headers: this.headers(),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error("download failed with HTTP " + response.status);
    }
    return response.blob();
  }
}
