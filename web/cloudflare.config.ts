import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  accountId: "616c24064281b4b8b8ba8a8e2f970bfb",
  worker: {
    name: "family-tree",
    entrypoint: "./dist/worker.mjs",
    compatibilityDate: "2026-10-27",
    workersDev: true,
    env: {
      DB: bindings.d1({ id: "e2a53cdf-af5d-4373-bafd-bebdc10c3563", name: "chha-gam-private" }),
      PHOTOS: bindings.r2({ name: "chha-gam-private-photos" }),
      BACKUP: bindings.r2({ name: "chha-gam-private-backup" }),
      BASE_PATH: bindings.text("/family-tree"),
      SITE_NAME: bindings.text("Chha Gam"),
      PUBLIC_ORIGIN: bindings.text("https://jaiamin.com"),
      OWNER_EMAIL: bindings.text("jaiamin130@gmail.com"),
      GOOGLE_CLIENT_ID: bindings.text("207540522825-6h5fk3lfe0jhcddpbmrm6e1n8i2rur02.apps.googleusercontent.com"),
      FAMILY_PASSWORD: bindings.secret(),
      MCP_TOKEN: bindings.secret(),
    },
    triggers: [triggers.scheduled({ schedule: "*/15 * * * *" })],
    observability: { enabled: true, redactQueryString: true, traces: { enabled: true } },
  },
});
