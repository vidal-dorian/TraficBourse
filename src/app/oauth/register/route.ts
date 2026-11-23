import { registerClient } from "@/lib/mcp/oauth/register";

// Read live from the environment and the database: never prerendered or cached.
export const dynamic = "force-dynamic";
// better-sqlite3 needs the Node.js runtime.
export const runtime = "nodejs";

/** Dynamic client registration (RFC 7591). */
export const POST = registerClient;
