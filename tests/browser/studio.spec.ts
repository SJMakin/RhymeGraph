import { readFile } from "node:fs/promises";

import { expect, test as base, type Locator, type Page } from "@playwright/test";

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "";
const appPath = (path: string) => `${basePath}${path}`;

interface RuntimeAudit {
  externalRequests: RuntimeRequest[];
  requests: RuntimeRequest[];
  unexpectedHttpWrites: RuntimeRequest[];
  runtimeErrors: string[];
  allowedRuntimeErrors: RegExp[];
}

interface RuntimeRequest {
  method: string;
  url: string;
}

function watchRuntime(page: Page, baseURL: string | undefined): RuntimeAudit {
  const allowedOrigin = baseURL ? new URL(baseURL).origin : undefined;
  const externalRequests: RuntimeRequest[] = [];
  const requests: RuntimeRequest[] = [];
  const unexpectedHttpWrites: RuntimeRequest[] = [];
  const runtimeErrors: string[] = [];
  page.on("request", (request) => {
    const record = { method: request.method().toUpperCase(), url: request.url() };
    requests.push(record);
    const url = new URL(record.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (record.method !== "GET" && record.method !== "HEAD") {
        unexpectedHttpWrites.push(record);
      }
      if (!allowedOrigin || url.origin !== allowedOrigin) {
        externalRequests.push(record);
      }
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  return {
    externalRequests,
    requests,
    unexpectedHttpWrites,
    runtimeErrors,
    allowedRuntimeErrors: [],
  };
}

const test = base.extend<{ runtime: RuntimeAudit }>({
  runtime: [async ({ page, baseURL }, use) => {
    const runtime = watchRuntime(page, baseURL);
    await use(runtime);
    expect(runtime.externalRequests, "the local-first studio must not contact third parties").toEqual([]);
    expect(
      runtime.unexpectedHttpWrites,
      "the local-first studio must not issue HTTP methods other than GET or HEAD",
    ).toEqual([]);
    const unexpectedErrors = runtime.runtimeErrors.filter(
      (error) => !runtime.allowedRuntimeErrors.some((pattern) => pattern.test(error)),
    );
    expect(unexpectedErrors, "the page must not emit unexpected console or runtime errors").toEqual([]);
  }, { auto: true }],
});

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

function semanticRequests(runtime: RuntimeAudit): string[] {
  return runtime.requests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return pathname.includes("/workers/semantic.worker.js")
      || pathname.includes("/models/")
      || /\/workers\/assets\/.*\.(?:wasm|mjs)$/.test(pathname);
  }).map((request) => request.url);
}

async function tabTo(page: Page, target: Locator, maximumTabs = 80, key = "Tab") {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Could not reach ${await target.first().evaluate((element) => element.outerHTML)} by keyboard.`);
}

async function expectVisibleFocus(target: Locator) {
  const hasFocusCue = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const outlined = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const shadowed = style.boxShadow !== "none";
    return outlined || shadowed;
  });
  expect(hasFocusCue, "keyboard focus needs a visible outline or shadow").toBe(true);
}

async function expectLightweightAccessibility(page: Page) {
  const violations = await page.locator("body").evaluate(() => {
    const visible = (element: Element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const accessibleName = (element: Element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const labels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? "").join(" ")
        : "";
      return [
        element.getAttribute("aria-label"),
        labelledText,
        labels,
        element.getAttribute("alt"),
        element.getAttribute("title"),
        element.textContent,
      ].some((value) => value?.trim());
    };
    const unnamed = Array.from(
      document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='tab']"),
    ).filter((element) => visible(element) && !accessibleName(element));
    const unlabelledImages = Array.from(document.querySelectorAll("img:not([alt])")).filter(visible);
    const positiveTabIndex = Array.from(document.querySelectorAll("[tabindex]"))
      .filter((element) => Number(element.getAttribute("tabindex")) > 0);
    return {
      unnamed: unnamed.map((element) => element.outerHTML.slice(0, 160)),
      unlabelledImages: unlabelledImages.map((element) => element.outerHTML.slice(0, 160)),
      positiveTabIndex: positiveTabIndex.map((element) => element.outerHTML.slice(0, 160)),
      mainLandmarks: document.querySelectorAll("main, [role='main']").length,
      pageHeadings: document.querySelectorAll("h1").length,
    };
  });

  expect(violations.unnamed, "interactive controls need accessible names").toEqual([]);
  expect(violations.unlabelledImages, "images need alt text, including an empty alt for decoration").toEqual([]);
  expect(violations.positiveTabIndex, "positive tabindex values create brittle focus order").toEqual([]);
  expect(violations.mainLandmarks, "the studio needs one main landmark").toBe(1);
  expect(violations.pageHeadings, "the studio needs a single page heading").toBe(1);
}

test("runs both local engines and supports the core writing loop", async ({ page, runtime }) => {
  test.skip(
    process.env.PLAYWRIGHT_SEMANTIC_SUITE === "skip",
    "CI runs the expensive semantic success path once, against the deploy-equivalent export.",
  );
  await page.addInitScript(() => {
    const browserState = globalThis as typeof globalThis & {
      rhymeGraphDelayedSemanticResults?: number;
    };
    browserState.rhymeGraphDelayedSemanticResults = 0;
    type WorkerListener = EventListenerOrEventListenerObject;
    type WorkerAddEventListener = (
      this: Worker,
      type: string,
      listener: WorkerListener,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    const nativeAddEventListener = Worker.prototype.addEventListener as WorkerAddEventListener;
    Worker.prototype.addEventListener = function (
      this: Worker,
      type: string,
      listener: WorkerListener,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "message" || typeof listener !== "function") {
        return nativeAddEventListener.call(this, type, listener, options);
      }
      const delayedListener: EventListener = (rawEvent) => {
        const event = rawEvent as MessageEvent<{ type?: string }>;
        if (event.data?.type !== "result") {
          listener.call(this, event);
          return;
        }
        browserState.rhymeGraphDelayedSemanticResults =
          (browserState.rhymeGraphDelayedSemanticResults ?? 0) + 1;
        window.setTimeout(() => listener.call(this, event), 400);
      };
      return nativeAddEventListener.call(this, type, delayedListener, options);
    } as typeof Worker.prototype.addEventListener;
  });
  await page.goto(appPath("/"));

  await expect(page).toHaveTitle(/RhymeGraph/);
  await expect(page.getByLabel("RhymeGraph")).toBeVisible();
  await expect(page.getByLabel("Lyric draft")).toHaveValue(/gravity/);
  await waitForStudio(page);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.waitForTimeout(1_200);
  expect(semanticRequests(runtime), "semantic assets must remain dormant before explicit opt-in").toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("rhymegraph.research.session.v1"))).toBeNull();
  const settingsButton = page.getByRole("button", { name: "Open local settings" });
  await settingsButton.click();
  await expect(page.getByRole("button", { name: "Close local settings" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Export research session" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start local research session" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("rhymegraph.research.session.v1"))).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Local intelligence and research settings")).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  await page.getByRole("button", { name: "Enable meaning" }).click();
  await expect(page.getByText("meaning ready", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(semanticRequests(runtime).length, "semantic opt-in must start the local model stack").toBeGreaterThan(0);
  expect(
    semanticRequests(runtime).filter((request) => request.includes("/onnx/model_quantized.onnx")),
    "the local model must not be transferred twice for loading progress metadata",
  ).toHaveLength(1);
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

  const deliveredResults = await page.evaluate(() => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults ?? 0);
  await page.getByLabel("Balance sound and meaning").fill("62");
  await page.waitForFunction((previous) => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults! > previous, deliveredResults);
  await page.getByRole("button", { name: "Disable meaning", exact: true }).click();
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable meaning" })).toBeVisible();
  await expect(page.locator(".candidate-rail button").first()).toBeVisible();

  await page.getByLabel("Project name").fill("PRIVATE PROJECT TITLE");
  await settingsButton.click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export research session" }).click();
  const download = await downloadEvent;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const researchExport = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    schemaId: string;
    schemaVersion: string;
    appVersion: string;
    privacy: { fullDraftIncluded: boolean; sentToNetwork: boolean; excluded: string[] };
    context: Record<string, unknown>;
    summary: Record<string, number>;
  };
  expect(researchExport.schemaId).toBe("urn:rhymegraph:research-session:1");
  expect(researchExport.schemaVersion).toBe("1.0.0");
  expect(researchExport.appVersion).toBe("0.2.0");
  expect(researchExport.privacy).toMatchObject({
    fullDraftIncluded: false,
    sentToNetwork: false,
    excluded: ["draftText", "projectTitle", "cursorPositions"],
  });
  expect(researchExport.context).not.toHaveProperty("draft");
  expect(JSON.stringify(researchExport)).not.toContain("PRIVATE PROJECT TITLE");
  expect(researchExport.summary.candidatesInserted).toBeGreaterThan(0);
  expect(researchExport.summary.candidatesUndone).toBeGreaterThan(0);
  expect(researchExport.summary.listViews).toBeGreaterThan(0);
  expect(researchExport.summary.mapViews).toBeGreaterThan(0);
  await page.screenshot({ path: "outputs/rhymegraph-settings.png", fullPage: true });
  await page.getByRole("button", { name: "Clear & stop" }).click();
  await expect(page.getByRole("button", { name: "Start local research session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export research session" })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("rhymegraph.research.session.v1"))).toBeNull();
  await page.getByRole("button", { name: "Close local settings" }).click();
  await page.screenshot({ path: "outputs/rhymegraph-desktop.png", fullPage: true });
});

test("@cross-browser supports the sound-first core loop by keyboard", async ({ page, runtime }) => {
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.waitForTimeout(1_200);
  expect(semanticRequests(runtime), "sound-first startup must not fetch semantic assets").toEqual([]);
  await expectLightweightAccessibility(page);

  const firstCandidate = page.locator(".candidate-rail button").first();
  await expect(firstCandidate).toBeVisible();
  await tabTo(page, firstCandidate);
  await expect(firstCandidate).toBeFocused();
  await expectVisibleFocus(firstCandidate);
  await page.keyboard.press("Enter");
  const inspectorHeading = page.locator(".inspector-panel h1");
  await expect(inspectorHeading).toBeVisible();
  const chosen = (await inspectorHeading.innerText()).trim();

  const pin = page.locator(".primary-actions").getByRole("button", { name: "Pin", exact: true });
  await tabTo(page, pin);
  await page.keyboard.press("Enter");
  await expect(page.locator(".family-tray")).toContainText(chosen);

  const draft = page.getByLabel("Lyric draft");
  const beforeInsert = await draft.inputValue();
  const insert = page.locator(".primary-actions").getByRole("button", { name: "Insert" });
  await tabTo(page, insert, 10, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(draft).not.toHaveValue(beforeInsert);
  expect(semanticRequests(runtime), "the keyboard sound loop must remain semantic-free").toEqual([]);
});

test("falls back to sound-only mode when the semantic worker asset fails", async ({ page, runtime }) => {
  runtime.allowedRuntimeErrors.push(/failed to load resource/i, /semantic\.worker/i);
  await page.route(/\/workers\/semantic\.worker\.js(?:\?.*)?$/, async (route) => {
    await route.abort("failed");
  });
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.getByRole("tab", { name: "Bridge" }).click();
  await expect(page.locator("[data-semantic-state='error']")).toBeVisible({ timeout: 20_000 });

  const draft = page.getByLabel("Lyric draft");
  await draft.click();
  await draft.press("ControlOrMeta+A");
  await draft.pressSequentially("stay bright");
  await expect(page.locator(".anchor-token strong")).toHaveText("bright");
  await expect(page.locator(".candidate-rail button").first()).toBeVisible({ timeout: 20_000 });
  expect(semanticRequests(runtime).some((request) => request.includes("semantic.worker.js"))).toBe(true);
});

test("reports meaning-model loading as indeterminate", async ({ page, runtime }) => {
  runtime.allowedRuntimeErrors.push(/failed to load resource/i);
  let markModelRequested!: () => void;
  let releaseModelResponse!: () => void;
  const modelRequested = new Promise<void>((resolveRequest) => {
    markModelRequested = resolveRequest;
  });
  const heldModelResponse = new Promise<void>((resolveResponse) => {
    releaseModelResponse = resolveResponse;
  });
  await page.route(/model_quantized\.onnx(?:\?.*)?$/, async (route) => {
    markModelRequested();
    await heldModelResponse;
    await route.abort("failed");
  });

  await page.goto(appPath("/"));
  await waitForStudio(page);
  await Promise.all([
    modelRequested,
    page.getByRole("button", { name: "Enable meaning" }).click(),
  ]);

  try {
    await page.getByRole("button", { name: "Open local settings" }).click();
    const progress = page.getByRole("progressbar", { name: "Meaning model loading" });
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute("aria-valuenow", /.+/);
    await expect(progress).not.toHaveAttribute("aria-valuemin", /.+/);
    await expect(progress).not.toHaveAttribute("aria-valuemax", /.+/);
    await expect(page.getByText("Loading locally · about 46 MiB", { exact: true })).toBeVisible();
    expect(await page.locator(".local-settings-card[data-semantic-state='loading']").innerText())
      .not.toMatch(/\b\d{1,3}%/);
  } finally {
    releaseModelResponse();
  }

  await expect(page.locator("[data-semantic-state='error']").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".candidate-rail button").first()).toBeVisible();
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

test("bounds malformed persisted project fields without opting into meaning", async ({ page, runtime }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("rhymegraph-test-session", "ready");
    localStorage.setItem("rhymegraph.project.v1", JSON.stringify({
      draft: { unexpected: true },
      title: "T".repeat(500),
      pins: ["one", null, "x".repeat(500), "one", { word: "unsafe" }, "two", "three", "four", "five", "six"],
      anchor: ["not a string"],
      anchorRange: { start: Number.MAX_SAFE_INTEGER + 1, end: Number.POSITIVE_INFINITY },
      breadcrumbs: ["gravity", false, "b".repeat(500), "gravity", "safe", {}, "end"],
      semanticEnabled: true,
    }));
    localStorage.setItem("rhymegraph.semantic.enabled.v1", "definitely");
  });
  await page.goto(appPath("/"));
  await waitForStudio(page);

  await expect(page.getByLabel("Lyric draft")).toHaveValue(/gravity/);
  await expect(page.getByLabel("Project name")).toHaveValue("T".repeat(120));
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.waitForTimeout(600);
  expect(semanticRequests(runtime)).toEqual([]);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("rhymegraph.project.v1");
    if (!raw) return null;
    const stored = JSON.parse(raw) as {
      draft: string;
      title: string;
      pins: string[];
      anchor: string;
      anchorRange: { start: number; end: number };
      breadcrumbs: string[];
    };
    return {
      draftIsString: typeof stored.draft === "string",
      titleLength: stored.title.length,
      pinsSafe: stored.pins.length <= 4 && stored.pins.every((item) => typeof item === "string" && item.length <= 96),
      breadcrumbsSafe: stored.breadcrumbs.length <= 8 && stored.breadcrumbs.every((item) => typeof item === "string" && item.length <= 96),
      rangeSafe: Number.isSafeInteger(stored.anchorRange.start)
        && Number.isSafeInteger(stored.anchorRange.end)
        && stored.anchorRange.start >= 0
        && stored.anchorRange.end <= stored.draft.length,
    };
  })).toEqual({
    draftIsString: true,
    titleLength: 120,
    pinsSafe: true,
    breadcrumbsSafe: true,
    rangeSafe: true,
  });
});

test("keeps insertion available at tablet and phone widths", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator(".mobile-candidate-actions .mobile-insert")).toBeVisible({ timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Explore", exact: true }).click();
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
