export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function serverMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const payload = body as {
    message?: unknown;
    code?: unknown;
    error?: unknown;
  };
  const nestedError =
    payload.error && typeof payload.error === "object"
      ? (payload.error as { message?: unknown; code?: unknown; type?: unknown })
      : undefined;
  const message =
    typeof payload.message === "string"
      ? payload.message
      : typeof nestedError?.message === "string"
        ? nestedError.message
        : undefined;
  if (!message) {
    return undefined;
  }
  const code =
    typeof payload.code === "string"
      ? payload.code
      : typeof nestedError?.code === "string"
        ? nestedError.code
        : typeof nestedError?.type === "string"
          ? nestedError.type
          : undefined;
  return code ? `${code}: ${message}` : message;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 120_000);
  try {
  const response = await fetch(url, {
    ...init,
    signal: controller.signal,
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new HttpError(
      serverMessage(body) ?? "HTTP " + response.status,
      response.status,
      body,
    );
  }
  return body as T;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
