import { authorizationServerMetadata } from "@/lib/mcp/oauth/metadata";

// Read live from the environment and the database: never prerendered or cached.
export const dynamic = "force-dynamic";
// better-sqlite3 needs the Node.js runtime.
export const runtime = "nodejs";

/** RFC 8414 metadata of the authorization server. */
export const GET = authorizationServerMetadata;
