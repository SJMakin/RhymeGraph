import { expect, test, type Page } from "@playwright/test";

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "";
const appPath = (path: string) => `${basePath}${path}`;
const allowedRuntimeHosts = new Set(["127.0.0.1", "localhost"]);
if (process.env.PLAYWRIGHT_BASE_URL) {
  allowedRuntimeHosts.add(new URL(process.env.PLAYWRIGHT_BASE_URL).hostname);
}

function watchRuntime(page: Page) {
  const externalRequests: string[] = [];
  const runtimeErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (!allowedRuntimeHosts.has(url.hostname)) {
        externalRequests.push(request.url());
      }
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  return { externalRequests, runtimeErrors };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("rhymegraph-test-session")) {
      localStorage.clear();
      sessionStorage.setItem("rhymegraph-test-session", "ready");
    }
  });
});

async function waitForStudio(page: Page) {
  await expect(page.getByText(/35,[0-9]{3} words local/)).toBeVisible({ timeout: 30_000 });
}

test("runs both local engines and supports the core writing loop", async ({ page }) => {
  const runtime = watchRuntime(page);
  await page.goto(appPath("/"));

  await expect(page).toHaveTitle(/RhymeGraph/);
  await expect(page.getByLabel("RhymeGraph")).toBeVisible();
  await expect(page.getByLabel("Lyric draft")).toHaveValue(/gravity/);
  await waitForStudio(page);
  await expect(page.getByText("meaning ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".candidate-rail button").first()).toBeVisible();

  await page.getByLabel("List view").click();
  await expect(page.locator(".full-list")).toBeVisible();
  await page.getByLabel("Map view").click();
  await expect(page.locator(".graph-stage:not(.list-mode)")).toBeVisible();

  await page.getByRole("tab", { name: "Bridge" }).click();
  await page.getByPlaceholder("quiet, escape, home…").fill("escape and home");
  await expect(page.getByText("on device")).toBeVisible();

  const secondCandidate = page.locator(".candidate-rail button").nth(1);
  await secondCandidate.click();
  const chosen = await page.locator(".inspector-panel h1").innerText();
  await page.locator(".primary-actions").getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.locator(".family-tray")).toContainText(chosen);

  const draft = page.getByLabel("Lyric draft");
  const beforeInsert = await draft.inputValue();
  await page.locator(".primary-actions").getByRole("button", { name: "Insert" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Inserted" })).toBeVisible();
  await expect(draft).not.toHaveValue(beforeInsert);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(draft).toHaveValue(beforeInsert);

  await page.screenshot({ path: "outputs/rhymegraph-desktop.png", fullPage: true });
  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.runtimeErrors).toEqual([]);
});

test("restores a draft with a safe anchor and clears stale OOV results", async ({ page }) => {
  await page.goto(appPath("/"));
  await waitForStudio(page);
  const draft = page.getByLabel("Lyric draft");
  await draft.click();
  await draft.press("Control+A");
  await draft.pressSequentially("keep it lowkey");
  await expect(page.locator(".anchor-token strong")).toHaveText("lowkey");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(draft).toHaveValue("keep it lowkey");
  await expect(page.locator(".anchor-token strong")).toHaveText("lowkey");

  await draft.click();
  await draft.press("Control+A");
  await draft.pressSequentially("blorptastic");
  await expect(page.locator(".anchor-token strong")).toHaveText("blorptastic");
  await expect(
    page.getByText("No local pronunciation found for “blorptastic”", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".candidate-rail button")).toHaveCount(0);
  await expect(page.locator(".empty-results")).toBeVisible();
});

test("keeps insertion available at tablet and phone widths", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator(".mobile-candidate-actions .mobile-insert")).toBeVisible({ timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Explore" }).click();
  const insert = page.locator(".mobile-candidate-actions .mobile-insert");
  await expect(insert).toBeVisible();
  const bounds = await insert.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "outputs/rhymegraph-mobile.png", fullPage: true });
});

test("publishes complete third-party notices", async ({ page }) => {
  await page.goto(appPath("/notices/"));
  await expect(page.getByRole("heading", { name: "Open-source notices" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ONNX Runtime third-party notices/ })).toHaveAttribute(
    "href",
    appPath("/licenses/ONNX-Runtime-ThirdPartyNotices.txt"),
  );
  const response = await page.request.get(appPath("/licenses/ONNX-Runtime-ThirdPartyNotices.txt"));
  expect(response.ok()).toBeTruthy();
  expect((await response.text()).length).toBeGreaterThan(300_000);
});
