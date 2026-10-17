// fetch with a timeout and one retry. Plain fetch only, so it runs in route handlers and scripts.

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.name = "HttpError";
  }
}

export type FetchOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

// Rate limits and server errors are worth one more try; other 4xx responses are not.
const isRetryable = (status: number) => status === 429 || status >= 500;

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, retries = 1, ...init } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      // A caller's signal (to cancel a request that lost a race) works alongside the timeout.
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const res = await fetch(url, { ...init, signal });
      if (res.ok) return res;
      const err = new HttpError(url, res.status, (await res.text()).slice(0, 500));
      if (!isRetryable(res.status)) throw err;
      lastError = err;
    } catch (err) {
      if (err instanceof HttpError && !isRetryable(err.status)) throw err;
      if (init.signal?.aborted) throw err; // cancelled by the caller: don't retry
      lastError = err;
    }
  }
  throw lastError;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, options);
  return (await res.json()) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "timed out";
    return err.message;
  }
  return String(err);
}
