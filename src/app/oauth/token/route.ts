import { issueToken } from "@/lib/mcp/oauth/token";

// Read live from the environment and the database: never prerendered or cached.
export const dynamic = "force-dynamic";
// better-sqlite3 needs the Node.js runtime.
export const runtime = "nodejs";

/** Token endpoint: code exchange and refresh. */
export const POST = issueToken;
