// Issue #13: every page links the pink gift icons and each linked icon URL loads.
import { test, expect } from "@playwright/test";

for (const page of ["index.html", "add.html", "bookmarklet.html"]) {
  test(`${page} links icons that load`, async ({ page: p, request }) => {
    await p.goto(`/${page}`);
    const links = await p.$$eval('link[rel="icon"], link[rel="apple-touch-icon"]', (els) =>
      els.map((e) => ({ rel: e.rel, href: e.href })),
    );
    expect(links.filter((l) => l.rel === "icon")).toHaveLength(2);
    expect(links.filter((l) => l.rel === "apple-touch-icon")).toHaveLength(1);
    for (const { href } of links) {
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
    }
  });
}
