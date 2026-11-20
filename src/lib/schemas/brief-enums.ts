// Enum values of the brief contract, free of any dependency: shared by the Zod schemas
// (./brief.ts) and the Drizzle schema, so the migration runner bundle does not pull in Zod.
export const CATEGORIES = ["monde", "geopolitique", "energie", "macro", "taux", "entreprises", "crypto"] as const;
export const MOODS = ["appetit_risque", "aversion_risque", "mitige"] as const;
export const BRIEF_KINDS = ["daily", "weekly"] as const;
