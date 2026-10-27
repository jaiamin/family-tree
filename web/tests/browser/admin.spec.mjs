import { test, expect } from "@playwright/test";
const basePath = process.env.BASE_PATH ?? "/family-tree";

async function owner(page) {
  await page.context().addCookies([{ name: "family_session", value: "synthetic-browser-owner", url: "http://localhost:8002", httpOnly: true }]);
  await page.goto(`${basePath}/`);
  await expect(page.locator('summary[aria-label="Family menu"]')).toBeVisible();
}
async function open(page, name) {
  await page.locator('summary[aria-label="Family menu"]').click();
  await page.getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

test("settings use focused forms with saved feedback and safe tree deletion", async ({ page }) => {
  await owner(page);
  await page.getByRole("button", { name: "Create tree", exact: true }).click();
  await page.getByLabel("New tree name").fill("Settings test family");
  await page.getByRole("dialog").getByRole("button", { name: "Create tree", exact: true }).click();
  await expect(page.getByText("Tree created.", { exact: true })).toBeVisible();
  let panel = await open(page, "Trees and settings");
  await panel.getByLabel("Website name").fill("Our family archive");
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Website name saved.", { exact: true })).toBeVisible();
  await expect(page.locator("#title")).toHaveText("Our family archive");
  panel = await open(page, "Trees and settings");
  await panel.locator(".admin-row").filter({ hasText: "Settings test family" }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Tree name", { exact: true }).fill("Renamed test family");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Tree saved.", { exact: true })).toBeVisible();
  panel = await open(page, "Trees and settings");
  await panel.locator(".admin-row").filter({ hasText: "Renamed test family" }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Delete tree grouping", exact: true }).click();
  const confirmation = page.getByLabel("Type Renamed test family to confirm");
  await confirmation.fill("Wrong name");
  await page.getByRole("button", { name: "Delete grouping", exact: true }).click();
  await expect(page.getByText("Enter the tree name exactly to confirm.")).toBeVisible();
  await confirmation.fill("Renamed test family");
  await page.getByRole("button", { name: "Delete grouping", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Renamed test family 0 people", exact: true })).toHaveCount(0);
});

test("access changes update in place, one-time credentials confirm creation and copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await owner(page);
  let panel = await open(page, "Editor access");
  await panel.getByLabel("Google email").fill("access-test@example.com");
  await panel.getByRole("button", { name: "Add editor", exact: true }).click();
  await expect(page.getByText("Editor access saved.", { exact: true })).toBeVisible();
  const account = panel.locator(".admin-row").filter({ hasText: "access-test@example.com" });
  await account.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(account.getByText("Access revoked", { exact: true })).toBeVisible();
  await account.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(account.getByText("Editor", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  panel = await open(page, "Agent access");
  await panel.getByLabel("Agent name").fill("Test assistant");
  await panel.getByRole("button", { name: "Create credential", exact: true }).click();
  await expect(panel.getByText("Credential created for Test assistant.", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent access saved.", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toBeVisible();
  const credential = await panel.getByRole("textbox", { name: "Copy credential", exact: true }).inputValue();
  await panel.getByRole("button", { name: "Copy credential", exact: true }).click();
  await expect(panel.getByText("Copied. Store it somewhere safe.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(credential);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  panel = await open(page, "Agent access");
  await expect(panel.getByRole("textbox", { name: "Copy credential", exact: true })).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await panel.locator(".admin-row").filter({ hasText: "Test assistant" }).getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(panel.getByText("Test assistant", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Agent access revoked.", { exact: true })).toBeVisible();
});

test("backup export stays open while busy and protects its recovery key", async ({ page }) => {
  await owner(page);
  const panel = await open(page, "Backups");
  await expect(panel.getByText("Last saved", { exact: true })).toBeVisible();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/backup/export", async route => { await gate; await route.fulfill({ contentType: "application/octet-stream", body: "synthetic encrypted export" }); });
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export encrypted backup", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Exporting…", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  release();
  expect((await download).suggestedFilename()).toBe("family-backup.encrypted");
  await expect(panel.getByText("Your encrypted backup is ready.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Copy recovery key", exact: true })).not.toBeEmpty();
  page.once("dialog", dialog => dialog.dismiss());
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toBeVisible();
  // A clipboard failure keeps the key selected and protected for manual copying.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(Error("Denied")) } }));
  await panel.getByRole("button", { name: "Copy recovery key", exact: true }).click();
  await expect(panel.getByText(/Couldn't copy automatically/)).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test("admin load and save errors remain recoverable on narrow screens", async ({ page }) => {
  await owner(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route("**/api/automation", route => route.fulfill({ status: 503, json: { error: "Agent access is unavailable. Try again." } }));
  let panel = await open(page, "Agent access");
  await expect(panel.getByRole("alert")).toHaveText("Agent access is unavailable. Try again.");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute("**/api/automation");
  panel = await open(page, "Agent access");
  await panel.getByLabel("Agent name").fill("A very long assistant name that should wrap without moving its controls outside this dialog");
  await page.route("**/api/automation", route => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { error: "Couldn't save. Try again." } }) : route.continue());
  await panel.getByRole("button", { name: "Create credential", exact: true }).click();
  await expect(panel.getByText("Couldn't save. Try again.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Create credential", exact: true })).toBeEnabled();
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("long access lists scroll beneath a fixed title and save action", async ({ page }) => {
  await owner(page);
  await page.route("**/api/users", route => route.fulfill({ json: Array.from({ length: 24 }, (_, index) => ({
    id: `synthetic-${index}`, name: `Family editor with a longer name ${index}`, email: `family.editor.${index}@example.com`, role: "editor", enabled: true,
  })) }));
  const panel = await open(page, "Editor access");
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    await page.evaluate(dark => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, width === 320);
    const body = panel.locator(".dialog-body");
    await body.evaluate(node => { node.scrollTop = 0; });
    const title = await panel.locator(".dialog-top").boundingBox();
    const action = await panel.getByRole("button", { name: "Add editor", exact: true }).boundingBox();
    expect(await body.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await panel.locator(".dialog-top").boundingBox()).toEqual(title);
    expect(await panel.getByRole("button", { name: "Add editor", exact: true }).boundingBox()).toEqual(action);
    await expect(panel.getByLabel("Google email")).toBeInViewport();
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});
