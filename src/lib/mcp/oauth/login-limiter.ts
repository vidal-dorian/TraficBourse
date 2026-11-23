// Brute-force guard of the login form, in memory (a restart clears it; the password is long, see
// `MIN_PASSWORD_LENGTH`, so this only slows an online guesser down).
//
// Per client address: after MAX_FAILURES wrong passwords within WINDOW_MS, that address is
// refused for LOCKOUT_MS without even comparing the password. A single attacker therefore cannot
// lock the owner out. A generous global ceiling (GLOBAL_MAX_FAILURES) still stops an attacker who
// rotates addresses, at the price of locking everyone, the owner included, for LOCKOUT_MS.
export const MAX_FAILURES = 5;
export const GLOBAL_MAX_FAILURES = 50;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;
/** Bucket of requests without `CF-Connecting-IP`. */
const UNKNOWN = "unknown";
const MAX_BUCKETS = 10_000;

type Bucket = { failures: number[]; lockedUntil: number };

const buckets = new Map<string, Bucket>();
let globalFailures: number[] = [];
let globalLockedUntil = 0;

/** The address Cloudflare saw, or one shared bucket when the header is missing. */
export function clientKey(request: Request): string {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  return address ? address.slice(0, 64) : UNKNOWN;
}

/** True while the lockout of this address (or the global one) lasts. */
export function isLockedOut(key: string, now = Date.now()): boolean {
  return now < globalLockedUntil || now < (buckets.get(key)?.lockedUntil ?? 0);
}

function recent(failures: number[], now: number): number[] {
  return [...failures.filter((at) => now - at < WINDOW_MS), now];
}

/** Records a wrong password; starts the lockout at the MAX_FAILURES-th one within the window. */
export function recordFailure(key: string, now = Date.now()): void {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [name, bucket] of buckets) {
      if (now >= bucket.lockedUntil && bucket.failures.every((at) => now - at >= WINDOW_MS)) buckets.delete(name);
    }
  }
  const bucket = buckets.get(key) ?? { failures: [], lockedUntil: 0 };
  bucket.failures = recent(bucket.failures, now);
  if (bucket.failures.length >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCKOUT_MS;
    bucket.failures = [];
    console.error(`OAuth login locked for ${LOCKOUT_MS / 60000} minutes after ${MAX_FAILURES} failed attempts from one address`);
  }
  buckets.set(key, bucket);

  globalFailures = recent(globalFailures, now);
  if (globalFailures.length >= GLOBAL_MAX_FAILURES) {
    globalLockedUntil = now + LOCKOUT_MS;
    globalFailures = [];
    console.error(`OAuth login locked for ${LOCKOUT_MS / 60000} minutes after ${GLOBAL_MAX_FAILURES} failed attempts overall`);
  }
}

/** Forgets the failures of this address (right password). */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}
