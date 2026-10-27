import { bindings, defineConfig, triggers } from "cf/config";

import { installationConfig } from "./scripts/config.mjs";
const config = installationConfig();

export default defineConfig({
  accountId: config.accountId,
  worker: {
    name: config.workerName,
    entrypoint: "./dist/worker.mjs",
    compatibilityDate: "2026-10-27",
    workersDev: true,
    env: {
      DB: bindings.d1({ id: config.databaseId, name: config.databaseName }),
      PHOTOS: bindings.r2({ name: config.photosBucket }),
      BACKUP: bindings.r2({ name: config.backupBucket }),
      BASE_PATH: bindings.text(config.basePath),
      SITE_NAME: bindings.text(config.siteName),
      PUBLIC_ORIGIN: bindings.text(config.publicOrigin),
      GOOGLE_CLIENT_ID: bindings.text(config.googleClientId || ""),
      FAMILY_PASSWORD: bindings.secret(),
      OWNER_EMAIL: bindings.text(config.ownerEmail),
    },
    triggers: [triggers.scheduled({ schedule: "*/15 * * * *" })],
    observability: { enabled: true, redactQueryString: true, traces: { enabled: true } },
  },
});
