// The "credential generation" of the owner's password: a random id that every OAuth token
// carries. When the password changes, a new id replaces it and every token issued before dies.
//
// Nothing stored is derived from the password quickly: the database holds the random id and a
// scrypt verifier (random salt, memory-hard) of the password, so a copy of it (a backup, say)
// does not allow fast offline guessing. scrypt runs once per password value per process.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appMeta } from "@/lib/db/schema";
import { getOwnerPassword } from "./config";

export const ID_KEY = "oauth_credential_id";
export const VERIFIER_KEY = "oauth_password_verifier";
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// scrypt needs 128 * N * r bytes (32 MiB), which is exactly the default cap: leave room.
const MAX_MEMORY = 64 * 1024 * 1024;

/** `scrypt$N$r$p$salt$hash` (salt and hash in hex). */
export function createVerifier(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, verifier: string): boolean {
  const [scheme, n, r, p, salt, hash] = verifier.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, "hex");
    const computed = scryptSync(password, Buffer.from(salt, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    });
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

let memo: { password: string; id: string } | undefined;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function readMeta(db: Pick<Tx, "select">): { id?: string; verifier?: string } {
  const rows = db.select().from(appMeta).where(inArray(appMeta.key, [ID_KEY, VERIFIER_KEY])).all();
  return {
    id: rows.find((row) => row.key === ID_KEY)?.value,
    verifier: rows.find((row) => row.key === VERIFIER_KEY)?.value,
  };
}

function matches(stored: { id?: string; verifier?: string }, password: string): stored is { id: string; verifier: string } {
  return Boolean(stored.id && stored.verifier && verifyPassword(password, stored.verifier));
}

function resolveGeneration(password: string): string {
  const stored = readMeta(getDb());
  if (matches(stored, password)) return stored.id;

  // New password (or first use): a new generation, which revokes every token of the old one.
  // The immediate transaction takes the write lock first, so a concurrent process that rotated
  // in the meantime is noticed instead of overwritten.
  return getDb().transaction(
    (tx) => {
      const current = readMeta(tx);
      if (matches(current, password)) return current.id;

      const id = randomBytes(16).toString("hex");
      for (const [key, value] of [
        [ID_KEY, id],
        [VERIFIER_KEY, createVerifier(password)],
      ] as const) {
        tx.insert(appMeta).values({ key, value }).onConflictDoUpdate({ target: appMeta.key, set: { value } }).run();
      }
      return id;
    },
    { behavior: "immediate" },
  );
}

/**
 * The generation id of the configured password, or undefined when no usable password is set
 * (every token is then refused). Memoized on the password value.
 */
export function currentCredential(): string | undefined {
  const password = getOwnerPassword();
  if (password === undefined) return undefined;
  if (memo?.password === password) return memo.id;
  const id = resolveGeneration(password);
  memo = { password, id };
  return id;
}
