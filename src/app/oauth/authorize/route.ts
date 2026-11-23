import { showLogin, submitLogin } from "@/lib/mcp/oauth/authorize";

// Read live from the environment and the database: never prerendered or cached.
export const dynamic = "force-dynamic";
// better-sqlite3 needs the Node.js runtime.
export const runtime = "nodejs";

/** Login page (GET) and password check (POST) of the authorization flow. */
export const GET = showLogin;
export const POST = submitLogin;
