// Brute-force guard of the login form. One owner, so one global in-memory counter is enough:
// after MAX_FAILURES wrong passwords within WINDOW_MS, every login attempt is refused for
// LOCKOUT_MS without even comparing the password. A restart clears it (the password is long, see
// `MIN_PASSWORD_LENGTH`; this only slows an online guesser down).
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

let failures: number[] = [];
let lockedUntil = 0;

/** True while the lockout lasts. */
export function isLockedOut(now = Date.now()): boolean {
  return now < lockedUntil;
}

/** Records a wrong password; starts the lockout at the MAX_FAILURES-th one within the window. */
export function recordFailure(now = Date.now()): void {
  failures = [...failures.filter((at) => now - at < WINDOW_MS), now];
  if (failures.length >= MAX_FAILURES) {
    lockedUntil = now + LOCKOUT_MS;
    failures = [];
    console.error(`OAuth login locked for ${LOCKOUT_MS / 60000} minutes after ${MAX_FAILURES} failed attempts`);
  }
}

/** Forgets the failures (right password). */
export function recordSuccess(): void {
  failures = [];
}
