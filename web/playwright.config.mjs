import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:8002", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"],
    ...process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {} } }],
  webServer: {
    command: "pnpm build && pnpm dev",
    url: "http://localhost:8002/family-tree/api/session",
    env: { PORT: "8002", DEV_DATA_DIR: mkdtempSync(join(tmpdir(),"family-browser-")) },
    reuseExistingServer: false,
  },
});
