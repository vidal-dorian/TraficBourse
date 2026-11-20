// `publish_brief(date, kind, payload, dry_run?)` (CLAUDE.md §7): the write tool of the Claude
// scheduled task. Arguments are validated by the server against `inputSchema` (all issues at
// once, one "path : message" line each) before the handler runs; the handler only writes.
import { z } from "zod";
import { publishBrief } from "@/lib/briefs/publish";
import { getDb } from "@/lib/db/client";
import { BriefDate, BriefKind, BriefPayload } from "@/lib/schemas/brief";
import type { McpTool } from "../server";

const inputSchema = {
  date: BriefDate.describe("Date du brief, AAAA-MM-JJ (Europe/Paris)."),
  kind: BriefKind.describe("« daily » pour le brief du jour, « weekly » pour le récapitulatif du samedi."),
  payload: BriefPayload.describe("Contenu structuré du brief (Markdown dans les textes, jamais de HTML)."),
  dry_run: z.boolean().default(false).describe("true : valide le contenu sans rien écrire."),
};

/** "1 actualité", "3 actualités". */
function newsLabel(count: number): string {
  return `${count} ${count === 1 ? "actualité" : "actualités"}`;
}

export const publishBriefTool: McpTool<typeof inputSchema> = {
  name: "publish_brief",
  description:
    "Publie le brief d'une date et d'un type (daily ou weekly). Remplace en une seule transaction le brief " +
    "déjà publié pour cette date et ce type. Avec dry_run = true, valide le contenu sans rien écrire. " +
    "Les erreurs de validation reviennent toutes ensemble, une ligne « chemin : message » par champ.",
  inputSchema,
  rawArguments: true,
  handler({ date, kind, payload, dry_run: dryRun }, rawArguments) {
    const newsCount = payload.news.length;
    if (dryRun) {
      return {
        content: [
          {
            type: "text",
            text:
              `Validation réussie : le brief ${kind} du ${date} et ses ${newsLabel(newsCount)} sont valides. ` +
              "Rien n'a été écrit ; rappelez publish_brief avec dry_run = false pour publier.",
          },
        ],
        structuredContent: { dryRun, date, kind, newsCount },
      };
    }

    // Stored exactly as received: the arguments came in as JSON, so this is the payload Claude sent.
    const rawPayload = JSON.stringify(rawArguments.payload);
    const { briefId } = publishBrief(getDb(), { date, kind, payload, rawPayload });
    return {
      content: [{ type: "text", text: `Brief ${kind} du ${date} publié avec ${newsLabel(newsCount)}.` }],
      structuredContent: { dryRun, briefId, date, kind, newsCount },
    };
  },
};
