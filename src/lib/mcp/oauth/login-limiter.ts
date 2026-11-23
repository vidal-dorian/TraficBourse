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

/** Eight 16-bit groups of an IPv6 address (`::` expanded, a trailing IPv4 turned into two groups), or undefined. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((octet) => octet > 255)) return undefined;
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * The bucket of an address: IPv4 as is, IPv6 by its /64 prefix (one subscriber owns a whole /64,
 * so single addresses would be free to rotate), IPv4-mapped IPv6 as the IPv4 address.
 */
export function addressBucket(address: string): string {
  const bare = address.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (!bare.includes(":")) return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) ? bare : UNKNOWN;
  const groups = ipv6Groups(bare);
  if (!groups) return UNKNOWN;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** The address Cloudflare saw, or one shared bucket when the header is missing or unreadable. */
export function clientKey(request: Request): string {
  const address = request.headers.get("cf-connecting-ip");
  return address ? addressBucket(address) : UNKNOWN;
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
