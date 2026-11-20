// Production tool registry served on /api/mcp (CLAUDE.md §7).
import type { McpTool } from "../server";
import { getRecentBriefsTool } from "./get-recent-briefs";
import { publishBriefTool } from "./publish-brief";

export const mcpTools: readonly McpTool[] = [publishBriefTool, getRecentBriefsTool];
