import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Tests share one emulator, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  // The app (127.0.0.1:4173) and the shop fixtures (localhost:4174) are different origins, as in
  // production: the bookmarklet must work cross-origin.
  webServer: [
    { command: "python3 -m http.server 4173 --bind 127.0.0.1", url: "http://127.0.0.1:4173/index.html", reuseExistingServer: !process.env.CI },
    { command: "python3 -m http.server 4174 --bind 127.0.0.1", url: "http://localhost:4174/index.html", reuseExistingServer: !process.env.CI },
  ],
});
