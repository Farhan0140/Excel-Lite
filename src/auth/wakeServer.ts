import { ApiError } from './api';

/* A free-tier host (Render, etc.) and its database can both be asleep when the app is opened, so the
   very first request may fail even though the server is fine — it just has not finished waking up yet.
   This retries the actual call (not just a /health ping, so a host that answers health checks before
   its own database is ready still gets retried) with a growing delay until it succeeds or fails for a
   reason that has nothing to do with cold-starting. Used only for the app's INITIAL connection: once
   signed in, ordinary saves already retry forever on their own (see SyncManager's backoff) — this is
   specifically the "is anyone home yet?" check that happens before that. */
export interface WakeOptions {
  onAttempt?: (attempt: number, delayMs: number) => void;
  maxWaitMs?: number; // give up after this long with no success at all (default ~2 minutes)
  signal?: AbortSignal;
}
const DELAYS = [500, 1000, 2000, 3000, 5000, 8000, 8000]; // grows, then holds at 8s

// true only for the kind of failure worth retrying (unreachable, or a 5xx that looks like a cold host) —
// a real 401/400/etc. means the server answered and something else is going on, so callers should not
// silently paper over it with a wake-up loop
export function looksLikeColdStart(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.network || e.status >= 500;
}

export async function retryUntilOk<T>(fn: () => Promise<T>, opts: WakeOptions = {}): Promise<T> {
  const start = Date.now();
  const maxWait = opts.maxWaitMs ?? 120_000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (opts.signal?.aborted || !looksLikeColdStart(e) || Date.now() - start >= maxWait) throw e;
      attempt++;
      const delay = DELAYS[Math.min(attempt - 1, DELAYS.length - 1)];
      opts.onAttempt?.(attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
