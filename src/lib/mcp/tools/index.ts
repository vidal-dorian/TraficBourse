// Production tool registry served on /api/mcp (CLAUDE.md §7). Empty until the business tools
// arrive (publish_brief and get_recent_briefs in US #13 and #14).
import type { McpTool } from "../server";

export const mcpTools: readonly McpTool[] = [];
