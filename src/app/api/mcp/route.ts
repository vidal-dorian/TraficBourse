import { createMcpHandler } from "@/lib/mcp/server";
import { mcpTools } from "@/lib/mcp/tools";

// Every call is authenticated and handled live: never prerendered or cached.
export const dynamic = "force-dynamic";
// better-sqlite3 (audit log) needs the Node.js runtime.
export const runtime = "nodejs";

const handle = createMcpHandler({ tools: mcpTools });

/** MCP endpoint (Streamable HTTP, stateless). Bearer token required on every method. */
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
