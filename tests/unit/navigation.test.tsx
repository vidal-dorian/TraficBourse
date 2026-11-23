// US #16 — the root layout links every page to « Aujourd'hui » and the archives, so a visitor
// landing on /archives, a brief or the 404 page can get back to the latest brief.
import { describe, expect, it, vi } from "vitest";
import { anchors, renderDocument } from "../helpers/home-page";

// The root layout imports its stylesheet; Vitest does not build CSS (Tailwind runs in Next.js).
vi.mock("../../src/app/globals.css", () => ({}));

describe("root layout navigation", () => {
  it("links to « Aujourd'hui » (/) and to the archives (/archives), in the same tab", async () => {
    const links = anchors(await renderDocument(<p>Une page</p>));

    for (const href of ["/", "/archives"]) {
      const link = links.find((anchor) => anchor.attributes.href === href);
      expect(link, `a link <a href="${href}"> must be shown`).toBeDefined();
      expect(link?.attributes.target, `${href} is an internal link`).toBeUndefined();
    }
  });
});
