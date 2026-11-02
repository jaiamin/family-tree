import { test, expect } from "@playwright/test";
const basePath = process.env.BASE_PATH ?? "/family-tree";

for (const width of [320, 1280]) {
  for (const evidence of ["referer", "fetch-metadata"]) {
    test(`password login with ${evidence} fallback at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.route("**/api/login", async route => {
        const headers = await route.request().allHeaders();
        if (evidence === "referer") {
          delete headers.origin;
          delete headers["sec-fetch-site"];
        } else {
          headers.origin = "null";
          delete headers.referer;
          // Emulate a browser retaining Fetch Metadata while hiding its origin.
          headers["sec-fetch-site"] = "same-origin";
        }
        await route.continue({ headers });
      });
      await page.goto(basePath || "/");
      await page.getByLabel("Password", { exact: true }).fill("local-preview-only");
      const login = page.waitForResponse(response => response.url().endsWith("/api/login"));
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      expect((await login).status()).toBe(200);
      await expect(page.locator('summary[aria-label="Family menu"]')).toBeVisible();
      await page.reload();
      await expect(page.locator('summary[aria-label="Family menu"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
