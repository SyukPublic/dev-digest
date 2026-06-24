/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Per-request controls. `timeoutMs` is opt-in (no default) so long-running
    operations like reindex/clone aren't cut off; pass `signal` to cancel from a
    caller (e.g. a TanStack Query queryFn's AbortSignal on unmount/refetch). */
export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  opts?: ApiRequestOptions,
): Promise<T> {
  // Combine an optional caller signal with an optional timeout signal.
  const signals: AbortSignal[] = [];
  if (init?.signal) signals.push(init.signal);
  if (opts?.timeoutMs != null) signals.push(AbortSignal.timeout(opts.timeoutMs));
  const signal =
    signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // A timeout aborts with a TimeoutError; everything else here is the API
    // being unreachable / down → full-screen error candidate.
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(
      isTimeout
        ? `Request to ${path} timed out.`
        : `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      isTimeout ? "timeout" : "network_error",
      e,
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: ApiRequestOptions) =>
    apiFetch<T>(path, { signal: opts?.signal }, opts),
  post: <T>(path: string, body?: unknown, opts?: ApiRequestOptions) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, signal: opts?.signal }, opts),
  put: <T>(path: string, body?: unknown, opts?: ApiRequestOptions) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined, signal: opts?.signal }, opts),
  patch: <T>(path: string, body?: unknown, opts?: ApiRequestOptions) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined, signal: opts?.signal }, opts),
  del: <T>(path: string, opts?: ApiRequestOptions) =>
    apiFetch<T>(path, { method: "DELETE", signal: opts?.signal }, opts),
};
