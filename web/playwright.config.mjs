import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const basePath = process.env.BASE_PATH ?? "/family-tree";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalTimeout: 5 * 60 * 1000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:8002", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"],
    ...process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {} } }],
  webServer: {
    command: "pnpm build && node tests/fixtures/browser-server.mjs",
    url: `http://localhost:8002${basePath}/api/session`,
    env: { PORT: "8002", DEV_DATA_DIR: mkdtempSync(join(tmpdir(),"family-browser-")) },
    reuseExistingServer: false,
  },
});
