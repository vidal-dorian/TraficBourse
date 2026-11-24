// US #13 — `publish_brief` payload fixtures (CLAUDE.md §7 and §10: valid and invalid payloads).
//
// Every helper returns a fresh deep copy, so a test can mutate its payload without touching
// another test's data. Paths are relative to the payload (as `BriefPayload` reports them); the
// MCP tests prefix them with `payload.`, the name of the tool argument carrying it.

/** A JSON value as sent by Claude: the payload goes over the wire as plain JSON. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const CATEGORIES = ["monde", "geopolitique", "energie", "macro", "taux", "entreprises", "crypto"] as const;
export const MOODS = ["appetit_risque", "aversion_risque", "mitige"] as const;

function copy<T extends Json>(value: T): T {
  return structuredClone(value);
}

/** One complete news item (every optional field filled). */
export function newsItem(overrides: JsonObject = {}): JsonObject {
  return copy({
    title: "La BCE maintient ses taux directeurs",
    summary: "La Banque centrale européenne laisse son taux de dépôt à **2 %**, comme attendu. Voir [le communiqué](https://www.ecb.europa.eu/press).",
    whyItMatters: "Les taux de la BCE influencent le coût des crédits et la rémunération de l'épargne en zone euro.",
    impact: "Peu de réaction attendue sur les marchés, la décision était anticipée.",
    category: "taux",
    tickers: ["^STOXX50E", "EURUSD=X"],
    sourceName: "BCE",
    sourceUrl: "https://www.ecb.europa.eu/press/pr/date/2026/html/index.en.html",
    ...overrides,
  });
}

/**
 * A valid daily payload with three news items. The third one has no `tickers`, so the stored
 * raw payload can be told apart from the parsed one (where `tickers` defaults to `[]`).
 */
export function validPayload(): JsonObject {
  return copy({
    tldr: "La BCE ne bouge pas, le pétrole recule et les valeurs technologiques reprennent des couleurs.",
    mood: "mitige",
    news: [
      newsItem(),
      newsItem({
        title: "Le Brent recule sous les 70 dollars",
        summary: "Le baril de Brent perd du terrain après l'annonce d'une hausse de production.",
        whyItMatters: "Le prix du pétrole pèse sur l'inflation et sur les valeurs de l'énergie.",
        impact: "Pression possible sur les valeurs pétrolières européennes.",
        category: "energie",
        tickers: ["BZ=F"],
        sourceName: "Reuters",
        sourceUrl: "https://www.reuters.com/business/energy/",
      }),
      {
        title: "Rebond des valeurs technologiques à Wall Street",
        summary: "Le Nasdaq 100 termine en hausse, porté par les semi-conducteurs.",
        whyItMatters: "Les grandes valeurs technologiques pèsent lourd dans les indices mondiaux.",
        impact: "Les ETF MSCI World en profitent aussi.",
        category: "entreprises",
        sourceName: "Les Echos",
        sourceUrl: "https://www.lesechos.fr/finance-marches",
      },
    ],
  });
}

/** A different valid payload (two news items, another mood), used to republish a date. */
export function otherValidPayload(): JsonObject {
  return copy({
    tldr: "Séance de repli : les marchés s'inquiètent des tensions commerciales.",
    mood: "aversion_risque",
    news: [
      newsItem({
        title: "Nouveaux droits de douane annoncés",
        summary: "Washington annonce des droits de douane supplémentaires sur l'acier européen.",
        whyItMatters: "Les droits de douane renchérissent les échanges et peuvent peser sur les bénéfices.",
        impact: "Les valeurs industrielles européennes reculent.",
        category: "geopolitique",
        tickers: ["^FCHI"],
        sourceName: "AFP",
        sourceUrl: "https://www.afp.com/fr",
      }),
      newsItem({
        title: "Le bitcoin repasse sous les 80 000 euros",
        summary: "Les cryptomonnaies suivent le mouvement de baisse des actifs risqués.",
        whyItMatters: "Le bitcoin réagit souvent comme un actif très risqué.",
        impact: "Volatilité accrue sur les cryptomonnaies.",
        category: "crypto",
        tickers: ["BTC-EUR"],
        sourceName: "Zonebourse",
        sourceUrl: "https://www.zonebourse.com/",
      }),
    ],
  });
}

/** A valid payload using every boundary at once (max lengths, five news items). */
export function boundaryPayload(): JsonObject {
  return copy({
    tldr: "t".repeat(400),
    mood: "appetit_risque",
    news: CATEGORIES.slice(0, 5).map((category, index) =>
      newsItem({
        title: `${index + 1}`.padEnd(120, "x"),
        summary: "s".repeat(600),
        whyItMatters: "w".repeat(400),
        impact: "i".repeat(300),
        category,
        tickers: [],
        sourceUrl: `http://exemple.fr/article-${index + 1}`,
      }),
    ),
  });
}

export type InvalidCase = {
  /** What is wrong, used in the test name. */
  name: string;
  payload: Json;
  /** Payload-relative path (dot-joined, "" for the payload itself) that must be reported. */
  path: string;
  /** A string the error must mention, when the path alone does not say what is wrong. */
  mentions?: string;
};

function withPayload(mutate: (payload: JsonObject) => void): JsonObject {
  const payload = validPayload();
  mutate(payload);
  return payload;
}

function firstNews(payload: JsonObject): JsonObject {
  return (payload.news as JsonObject[])[0];
}

/** Payloads that each break one rule of the contract. */
export function invalidCases(): InvalidCase[] {
  return [
    { name: "tldr missing", payload: withPayload((p) => delete p.tldr), path: "tldr" },
    { name: "tldr blank", payload: withPayload((p) => (p.tldr = "   ")), path: "tldr" },
    { name: "tldr longer than 400 characters", payload: withPayload((p) => (p.tldr = "t".repeat(401))), path: "tldr" },
    { name: "mood missing", payload: withPayload((p) => delete p.mood), path: "mood" },
    { name: "mood outside the enum", payload: withPayload((p) => (p.mood = "euphorie")), path: "mood" },
    { name: "news missing", payload: withPayload((p) => delete p.news), path: "news" },
    { name: "zero news items", payload: withPayload((p) => (p.news = [])), path: "news" },
    {
      name: "six news items",
      payload: withPayload((p) => (p.news = Array.from({ length: 6 }, (_, i) => newsItem({ title: `Actualité ${i + 1}` })))),
      path: "news",
    },
    { name: "news item title missing", payload: withPayload((p) => delete firstNews(p).title), path: "news.0.title" },
    { name: "news item title blank", payload: withPayload((p) => (firstNews(p).title = "")), path: "news.0.title" },
    {
      name: "news item title longer than 120 characters",
      payload: withPayload((p) => (firstNews(p).title = "x".repeat(121))),
      path: "news.0.title",
    },
    {
      name: "news item summary longer than 600 characters",
      payload: withPayload((p) => (firstNews(p).summary = "s".repeat(601))),
      path: "news.0.summary",
    },
    {
      name: "news item whyItMatters longer than 400 characters",
      payload: withPayload((p) => (firstNews(p).whyItMatters = "w".repeat(401))),
      path: "news.0.whyItMatters",
    },
    {
      name: "news item impact longer than 300 characters",
      payload: withPayload((p) => (firstNews(p).impact = "i".repeat(301))),
      path: "news.0.impact",
    },
    { name: "news item impact missing", payload: withPayload((p) => delete firstNews(p).impact), path: "news.0.impact" },
    {
      name: "news item category outside the enum",
      payload: withPayload((p) => ((p.news as JsonObject[])[1].category = "sport")),
      path: "news.1.category",
    },
    { name: "news item category missing", payload: withPayload((p) => delete firstNews(p).category), path: "news.0.category" },
    { name: "news item sourceName missing", payload: withPayload((p) => delete firstNews(p).sourceName), path: "news.0.sourceName" },
    { name: "news item sourceUrl missing", payload: withPayload((p) => delete firstNews(p).sourceUrl), path: "news.0.sourceUrl" },
    {
      name: "news item sourceUrl with a javascript: scheme",
      payload: withPayload((p) => (firstNews(p).sourceUrl = "javascript:alert(1)")),
      path: "news.0.sourceUrl",
    },
    {
      name: "news item sourceUrl with a data: scheme",
      payload: withPayload((p) => (firstNews(p).sourceUrl = "data:text/html,<script>alert(1)</script>")),
      path: "news.0.sourceUrl",
    },
    {
      name: "news item sourceUrl with an ftp: scheme",
      payload: withPayload((p) => (firstNews(p).sourceUrl = "ftp://exemple.fr/article")),
      path: "news.0.sourceUrl",
    },
    {
      name: "news item sourceUrl relative",
      payload: withPayload((p) => (firstNews(p).sourceUrl = "/finance/article")),
      path: "news.0.sourceUrl",
    },
    {
      name: "news item tickers not an array of strings",
      payload: withPayload((p) => (firstNews(p).tickers = "^FCHI")),
      path: "news.0.tickers",
    },
    {
      name: "unknown key stockNotes in the payload (later ticket)",
      payload: withPayload((p) => (p.stockNotes = [])),
      path: "",
      mentions: "stockNotes",
    },
    {
      name: "unknown key concept in the payload (later ticket)",
      payload: withPayload((p) => (p.concept = { slug: "inflation", explanation: "e", analogy: "a", example: "x" })),
      path: "",
      mentions: "concept",
    },
    {
      name: "unknown key imageUrl in a news item (never any image)",
      payload: withPayload((p) => (firstNews(p).imageUrl = "https://exemple.fr/image.png")),
      path: "news.0",
      mentions: "imageUrl",
    },
    { name: "payload not an object", payload: "brief du jour", path: "" },
  ];
}

/** One payload breaking several rules at once, with every path that must be reported. */
export function payloadWithSeveralErrors(): { payload: JsonObject; paths: string[] } {
  const payload = validPayload();
  payload.tldr = "t".repeat(401);
  payload.mood = "euphorie";
  const news = payload.news as JsonObject[];
  delete news[0].sourceName;
  news[1].sourceUrl = "javascript:alert(1)";
  news[2].category = "sport";
  return { payload, paths: ["tldr", "mood", "news.0.sourceName", "news.1.sourceUrl", "news.2.category"] };
}

/**
 * A valid payload at the limits of the bounded metadata fields: a 120-character source name, a
 * 2048-character URL and ten 20-character tickers, plus real provider symbols in another item.
 */
export function metadataLimitsPayload(): JsonObject {
  return withPayload((p) => {
    const news = p.news as JsonObject[];
    news[0].sourceName = "n".repeat(120);
    news[0].sourceUrl = `https://exemple.fr/${"a".repeat(2048 - "https://exemple.fr/".length)}`;
    news[0].tickers = Array.from({ length: 10 }, (_, i) => `T${i}`.padEnd(20, "X"));
    news[1].tickers = ["^FCHI", "^STOXX50E", "EURUSD=X", "GC=F", "BTC-EUR", "IWDA.AS", "MC.PA", "brk-b"];
  });
}

/**
 * Payloads breaking a size or format limit of the news item metadata (sourceName, sourceUrl,
 * tickers): without them one call could store megabytes in `raw_payload` and `news_items`.
 */
export function metadataLimitCases(): InvalidCase[] {
  return [
    {
      name: "news item sourceName longer than 120 characters",
      payload: withPayload((p) => (firstNews(p).sourceName = "n".repeat(121))),
      path: "news.0.sourceName",
    },
    { name: "news item sourceName blank", payload: withPayload((p) => (firstNews(p).sourceName = " ")), path: "news.0.sourceName" },
    {
      name: "news item sourceUrl longer than 2048 characters",
      payload: withPayload((p) => (firstNews(p).sourceUrl = `https://exemple.fr/${"a".repeat(2048)}`)),
      path: "news.0.sourceUrl",
      mentions: "2048",
    },
    {
      name: "news item with eleven tickers",
      payload: withPayload((p) => (firstNews(p).tickers = Array.from({ length: 11 }, (_, i) => `T${i}`))),
      path: "news.0.tickers",
    },
    {
      name: "news item ticker longer than 20 characters",
      payload: withPayload((p) => (firstNews(p).tickers = ["^FCHI", "T".repeat(21)])),
      path: "news.0.tickers.1",
    },
    { name: "news item ticker empty", payload: withPayload((p) => (firstNews(p).tickers = [""])), path: "news.0.tickers.0" },
    {
      name: "news item ticker with a space",
      payload: withPayload((p) => (firstNews(p).tickers = ["MC PA"])),
      path: "news.0.tickers.0",
    },
    {
      name: "news item ticker with markup",
      payload: withPayload((p) => (firstNews(p).tickers = ["<b>AI</b>"])),
      path: "news.0.tickers.0",
    },
  ];
}
