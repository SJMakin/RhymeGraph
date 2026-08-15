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
  await expect(page.getByText(/[0-9]{2,3},[0-9]{3} terms local/i)).toBeVisible({ timeout: 30_000 });
}

function semanticRequests(runtime: RuntimeAudit): string[] {
  return runtime.requests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return pathname.includes("/workers/semantic.worker")
      || pathname.includes("/models/")
      || pathname.includes("/data/semantic-index.")
      || /\/workers\/assets\/.*\.(?:wasm|mjs)(?:$|\?)/.test(pathname);
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
      rhymeGraphDelayedHybridResults?: number;
      rhymeGraphFailNextSemanticRetrieve?: boolean;
      rhymeGraphFailNextHybridResult?: boolean;
      rhymeGraphHybridPhoneticRequestIds?: number[];
      rhymeGraphWorkerRequests?: Array<{
        type?: string;
        requestId?: number;
        intent?: string;
        meaningWeight?: number;
        queryText?: string;
      }>;
    };
    browserState.rhymeGraphDelayedSemanticResults = 0;
    browserState.rhymeGraphDelayedHybridResults = 0;
    browserState.rhymeGraphHybridPhoneticRequestIds = [];
    browserState.rhymeGraphWorkerRequests = [];
    const nativePostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      options?: StructuredSerializeOptions | Transferable[],
    ) {
      const request = message && typeof message === "object"
        ? message as {
          type?: string;
          requestId?: number;
          intent?: string;
          queryText?: string;
          weights?: { meaning?: number };
        }
        : {};
      browserState.rhymeGraphWorkerRequests?.push({
        type: request.type,
        requestId: request.requestId,
        intent: request.intent,
        meaningWeight: request.weights?.meaning,
        queryText: request.queryText,
      });
      if (
        request.type === "search"
        && typeof request.requestId === "number"
        && (request.weights?.meaning ?? 0) > 0
      ) {
        browserState.rhymeGraphHybridPhoneticRequestIds?.push(request.requestId);
      }
      return nativePostMessage.call(this, message, options as StructuredSerializeOptions);
    } as typeof Worker.prototype.postMessage;
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
        const event = rawEvent as MessageEvent<{ type?: string; requestId?: number }>;
        if (event.data?.type !== "result" && event.data?.type !== "retrieved") {
          listener.call(this, event);
          return;
        }
        browserState.rhymeGraphDelayedSemanticResults =
          (browserState.rhymeGraphDelayedSemanticResults ?? 0) + 1;
        const hybridResult = event.data.type === "result"
          && typeof event.data.requestId === "number"
          && browserState.rhymeGraphHybridPhoneticRequestIds?.includes(event.data.requestId);
        if (hybridResult) {
          browserState.rhymeGraphDelayedHybridResults =
            (browserState.rhymeGraphDelayedHybridResults ?? 0) + 1;
        }
        window.setTimeout(() => {
          if (event.data.type === "retrieved" && browserState.rhymeGraphFailNextSemanticRetrieve) {
            browserState.rhymeGraphFailNextSemanticRetrieve = false;
            listener.call(this, new MessageEvent("message", {
              data: {
                type: "error",
                requestId: event.data.requestId,
                message: "Injected stale semantic request failure.",
              },
            }));
            return;
          }
          if (hybridResult && browserState.rhymeGraphFailNextHybridResult) {
            browserState.rhymeGraphFailNextHybridResult = false;
            listener.call(this, new MessageEvent("message", {
              data: {
                type: "error",
                requestId: event.data.requestId,
                message: "Injected stale hybrid phonetic request failure.",
              },
            }));
            return;
          }
          listener.call(this, event);
        }, event.data.type === "result" ? 800 : 400);
      };
      return nativeAddEventListener.call(this, type, delayedListener, options);
    } as typeof Worker.prototype.addEventListener;
  });
  await page.goto(appPath("/"));

  await expect(page).toHaveTitle(/RhymeGraph/);
  await expect(page.getByLabel("RhymeGraph")).toBeVisible();
  await expect(page.getByLabel("Lyric draft")).toHaveValue(/gravity/);
  await expect(page.getByLabel("Lyric draft")).toHaveAttribute("spellcheck", "false");
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
  await expect(
    page.getByText("Sound + meaning searched across 54,140 local terms", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  expect(semanticRequests(runtime).length, "semantic opt-in must start the local model stack").toBeGreaterThan(0);
  expect(
    semanticRequests(runtime).filter((request) => request.includes("/data/semantic-index.v1.bin")),
    "whole-vocabulary meaning search must load the checked-in local vector index once",
  ).toHaveLength(1);
  expect(
    semanticRequests(runtime).filter((request) => request.includes("/onnx/model_quantized.onnx")),
    "the local model must not be transferred twice for loading progress metadata",
  ).toHaveLength(1);

  const requestMarker = await page.evaluate(() => (
    globalThis as typeof globalThis & { rhymeGraphWorkerRequests?: unknown[] }
  ).rhymeGraphWorkerRequests?.length ?? 0);
  await page.getByRole("tab", { name: "Pivot" }).click();
  await page.waitForFunction((marker) => {
    const requests = (
      globalThis as typeof globalThis & {
        rhymeGraphWorkerRequests?: Array<{
          type?: string;
          intent?: string;
          meaningWeight?: number;
        }>;
      }
    ).rhymeGraphWorkerRequests ?? [];
    return requests.slice(marker).some((request) => (
      request.type === "search"
      && request.intent === "pivot"
      && request.meaningWeight === 0
    ));
  }, requestMarker);
  // Phonetic results are held for 800 ms by the worker-listener shim above.
  // During that window a changed intent has no current base generation, so it
  // must not launch a semantic retrieve or a hybrid phonetic request.
  await page.waitForTimeout(300);
  const requestsBeforeNewBase = await page.evaluate((marker) => {
    const requests = (
      globalThis as typeof globalThis & {
        rhymeGraphWorkerRequests?: Array<{
          type?: string;
          intent?: string;
          meaningWeight?: number;
        }>;
      }
    ).rhymeGraphWorkerRequests ?? [];
    return requests.slice(marker);
  }, requestMarker);
  expect(
    requestsBeforeNewBase.filter((request) => request.type === "retrieve"),
    "an intent change must wait for its own sound base before semantic retrieval",
  ).toEqual([]);
  expect(
    requestsBeforeNewBase.filter((request) => request.type === "search" && (request.meaningWeight ?? 0) > 0),
    "an old-base hybrid must never supersede the new sound request",
  ).toEqual([]);
  await expect(
    page.getByText("Sound + meaning searched across 54,140 local terms", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await expect(page.getByLabel("Family view")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Locked landings" })).toBeVisible();
  await expect(page.locator(".family-candidate").first()).toBeVisible();

  await page.getByLabel("List view").click();
  await expect(page.locator(".full-list")).toBeVisible();
  await page.getByLabel("Map view").click();
  await expect(page.locator(".graph-stage.map-mode")).toBeVisible();
  await expect(page.getByText("Actual candidate-to-candidate sound links", { exact: true })).toBeVisible();
  await expect(page.locator(".graph-edges .neighbour-edge").first()).toBeAttached();
  await page.locator(".graph-node").nth(1).click();
  // A perfectly horizontal/vertical SVG line can have a zero-height/width
  // bounding box even while its stroke is rendered. Attachment plus the
  // active selector proves the graph selection reached a real neighbour edge.
  await expect(page.locator(".graph-edges .neighbour-edge.active").first()).toBeAttached();

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
  const pathBeforeInsert = await page.locator(".path-card p").innerText();
  await page.locator(".primary-actions").getByRole("button", { name: "Insert" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Inserted" })).toBeVisible();
  await expect(draft).not.toHaveValue(beforeInsert);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(draft).toHaveValue(beforeInsert);
  await expect(page.locator(".path-card p")).toHaveText(pathBeforeInsert);

  const meaningControl = page.getByLabel("Balance sound and meaning");
  await meaningControl.fill("0");
  await expect(page.locator(".sr-only[aria-live='polite']")).toContainText("Sound-only neighbourhood restored");
  const soundOnlyCandidates = await page.locator(".candidate-rail button").allTextContents();
  const deliveredResults = await page.evaluate(() => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults ?? 0);
  const mixRequestMarker = await page.evaluate(() => (
    globalThis as typeof globalThis & { rhymeGraphWorkerRequests?: unknown[] }
  ).rhymeGraphWorkerRequests?.length ?? 0);
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & { rhymeGraphFailNextSemanticRetrieve?: boolean }
    ).rhymeGraphFailNextSemanticRetrieve = true;
  });
  await meaningControl.fill("62");
  await page.waitForFunction((previous) => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults! > previous, deliveredResults);
  await meaningControl.fill("0");
  await expect(page.locator(".sr-only[aria-live='polite']")).toContainText("Sound-only neighbourhood restored");
  await page.waitForTimeout(900);
  await expect(page.locator("[data-semantic-state='ready']").first()).toBeVisible();
  expect(
    await page.locator(".candidate-rail button").allTextContents(),
    "a delayed semantic result must not repaint after the mix returns to zero",
  ).toEqual(soundOnlyCandidates);
  const requestsAfterZeroMix = await page.evaluate((marker) => {
    const requests = (
      globalThis as typeof globalThis & {
        rhymeGraphWorkerRequests?: Array<{ type?: string; meaningWeight?: number }>;
      }
    ).rhymeGraphWorkerRequests ?? [];
    return requests.slice(marker);
  }, mixRequestMarker);
  expect(
    requestsAfterZeroMix.filter((request) => request.type === "search" && (request.meaningWeight ?? 0) > 0),
    "zero mix must invalidate a semantic result before it can launch hybrid phonetic search",
  ).toEqual([]);

  await meaningControl.fill("62");
  await expect(
    page.getByText("Sound + meaning searched across 54,140 local terms", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  const delayedHybridResults = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      rhymeGraphDelayedHybridResults?: number;
      rhymeGraphFailNextHybridResult?: boolean;
    };
    state.rhymeGraphFailNextHybridResult = true;
    return state.rhymeGraphDelayedHybridResults ?? 0;
  });
  await meaningControl.fill("71");
  await page.waitForFunction((previous) => (
    globalThis as typeof globalThis & { rhymeGraphDelayedHybridResults?: number }
  ).rhymeGraphDelayedHybridResults! > previous, delayedHybridResults);
  await meaningControl.fill("0");
  await expect(page.locator(".sr-only[aria-live='polite']")).toContainText("Sound-only neighbourhood restored");
  await page.waitForTimeout(900);
  await expect(page.locator("[data-semantic-state='ready']").first()).toBeVisible();
  await expect(page.locator(".engine-status > span").first()).toContainText(/[0-9]{2,3},[0-9]{3} terms local/i);
  expect(
    await page.locator(".candidate-rail button").allTextContents(),
    "a stale hybrid phonetic error must leave the restored sound base intact",
  ).toEqual(soundOnlyCandidates);

  await meaningControl.fill("62");
  await expect(
    page.getByText("Sound + meaning searched across 54,140 local terms", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const deliveredBeforeDisable = await page.evaluate(() => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults ?? 0);
  await meaningControl.fill("71");
  await page.waitForFunction((previous) => (
    globalThis as typeof globalThis & { rhymeGraphDelayedSemanticResults?: number }
  ).rhymeGraphDelayedSemanticResults! > previous, deliveredBeforeDisable);
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
  expect(researchExport.appVersion).toBe("0.3.0");
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

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is unavailable.", "QuotaExceededError");
    };
  });
  await page.getByLabel("Project name").fill("unsaved local edit");
  await expect(page.getByText("Not saved on this device", { exact: true })).toBeVisible();
  await page.waitForTimeout(3_600);
  await expect(page.getByText("Not saved on this device", { exact: true })).toBeVisible();
});

test("@cross-browser supports the sound-first core loop by keyboard", async ({ page, runtime }) => {
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.waitForTimeout(1_200);
  expect(semanticRequests(runtime), "sound-first startup must not fetch semantic assets").toEqual([]);
  await expectLightweightAccessibility(page);

  const firstCandidate = page.locator(".family-candidate").first();
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
  await page.route(/\/workers\/semantic\.worker(?:\.v\d+)?\.js(?:\?.*)?$/, async (route) => {
    await route.abort("failed");
  });
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator("[data-semantic-state='idle']")).toBeVisible();
  await page.getByRole("tab", { name: "Bridge" }).click();
  await expect(page.locator("[data-semantic-state='error']")).toBeVisible({ timeout: 20_000 });
  const meaningControl = page.getByLabel("Balance sound and meaning");
  await expect(meaningControl).toHaveValue("0");
  await expect(meaningControl).toBeDisabled();
  await expect(meaningControl).toHaveAttribute("aria-valuetext", /Unavailable, 0% mix position/i);
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();

  const draft = page.getByLabel("Lyric draft");
  await draft.click();
  await draft.press("ControlOrMeta+A");
  await draft.pressSequentially("stay bright");
  await expect(page.locator(".anchor-token strong")).toHaveText("bright");
  await expect(page.locator(".family-candidate").first()).toBeVisible({ timeout: 20_000 });
  expect(semanticRequests(runtime).some((request) => request.includes("semantic.worker"))).toBe(true);
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
    await expect(page.getByText("Loading locally · about 69 MiB", { exact: true })).toBeVisible();
    expect(await page.locator(".local-settings-card[data-semantic-state='loading']").innerText())
      .not.toMatch(/\b\d{1,3}%/);
  } finally {
    releaseModelResponse();
  }

  await expect(page.locator("[data-semantic-state='error']").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".family-candidate").first()).toBeVisible();
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
  await expect(page.locator(".family-candidate")).toHaveCount(0);
  await expect(page.locator(".empty-results")).toBeVisible();
});

test("makes the Reach control change the explored sound families", async ({ page }) => {
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await page.getByLabel("List view").click();
  const reach = page.getByLabel("Rhyme adventurousness");

  await reach.fill("0");
  await expect(reach).toHaveAttribute("aria-valuetext", /Close, 0% reach/);
  await expect.poll(async () => page.locator(".full-list .result-word").evaluateAll(
    (nodes) => nodes.slice(0, 10).map((node) => node.firstChild?.textContent?.trim() ?? ""),
  )).not.toEqual([]);
  const close = await page.locator(".full-list .result-word").evaluateAll(
    (nodes) => nodes.slice(0, 10).map((node) => node.firstChild?.textContent?.trim() ?? ""),
  );

  await reach.fill("100");
  await expect(reach).toHaveAttribute("aria-valuetext", /Far out, 100% reach/);
  await expect.poll(async () => page.locator(".full-list .result-word").evaluateAll(
    (nodes) => nodes.slice(0, 10).map((node) => node.firstChild?.textContent?.trim() ?? ""),
  )).not.toEqual(close);
  const far = await page.locator(".full-list .result-word").evaluateAll(
    (nodes) => nodes.slice(0, 10).map((node) => node.firstChild?.textContent?.trim() ?? ""),
  );
  expect(far.filter((word) => close.includes(word)).length).toBeLessThan(close.length);
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

test("keeps family exploration and explanations complete on small monitors", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(appPath("/"));
  await waitForStudio(page);

  const dialectProfile = page.getByRole("button", { name: /Pronunciation profile: UK non-rhotic beta/i });
  await expect(dialectProfile).toBeVisible();
  await dialectProfile.click();
  await expect(page.getByRole("button", { name: /Pronunciation profile: General American/i })).toBeVisible();
  await page.getByRole("button", { name: /Pronunciation profile: General American/i }).click();

  await expect(page.getByLabel("Family view")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Locked landings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vowel & slant" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Consonant echoes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Phrase & mosaic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meaning & sideways" })).toBeVisible();
  await expect(page.getByLabel("Balance sound and meaning")).toBeVisible();
  await expect(page.getByLabel("Rhyme adventurousness")).toBeVisible();
  await expect(page.getByText("Sound only", { exact: true })).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();

  await expect.poll(async () => page.locator(".family-channel > header > span").evaluateAll(
    (counts) => counts.reduce((total, count) => total + Number(count.textContent ?? 0), 0),
  )).toBeGreaterThan(18);

  const initialExplorer = await page.locator(".explore-panel").boundingBox();
  expect(initialExplorer).not.toBeNull();
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.locator(".draft-panel")).not.toBeVisible();
  const focusedExplorer = await page.locator(".explore-panel").boundingBox();
  expect(focusedExplorer).not.toBeNull();
  expect(focusedExplorer!.width).toBeGreaterThan(initialExplorer!.width + 300);

  const firstFamilyCandidate = page.locator(".family-candidate").first();
  await firstFamilyCandidate.click();
  await expect(page.locator(".inspector-panel")).toBeVisible();
  await expect(page.locator(".inspector-panel .definition")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close candidate details" })).toBeVisible();
  await page.getByRole("button", { name: "Close candidate details" }).click();
  await expect(page.locator(".inspector-panel")).not.toBeVisible();
  await page.getByRole("button", { name: "Show draft" }).click();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByLabel("Rhyme adventurousness")).toBeVisible();
  await expect(page.getByLabel("Family view")).toBeVisible();
  await expect(page.getByLabel("Map view")).toBeVisible();
  await expect(page.getByLabel("List view")).toBeVisible();
  await expect(page.locator(".inspector-panel")).not.toBeVisible();
  await page.locator(".family-candidate").first().click();
  await expect(page.locator(".inspector-panel .reason-chips")).toBeVisible();
  await page.getByRole("button", { name: "Close candidate details" }).click();

  await page.getByRole("button", { name: "Filters" }).click();
  const syllableFilter = page.getByLabel("Syllables");
  const partOfSpeechFilter = page.getByLabel("Part of speech");
  let foundEmptyFilterCombination = false;
  for (const syllables of ["4", "3", "2", "1"]) {
    for (const partOfSpeech of ["adverb", "verb", "adjective", "noun"]) {
      await syllableFilter.selectOption(syllables);
      await partOfSpeechFilter.selectOption(partOfSpeech);
      if (await page.locator(".empty-results").isVisible()) {
        foundEmptyFilterCombination = true;
        break;
      }
    }
    if (foundEmptyFilterCombination) break;
  }
  expect(foundEmptyFilterCombination, "the filter matrix should include an empty slice").toBe(true);
  await expect(page.getByText("No neighbours match these filters.", { exact: true })).toBeVisible();
  await expect(page.locator(".inspector-panel h1")).toHaveCount(0);
  await expect(page.locator(".mobile-candidate-actions")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".family-candidate").first()).toBeVisible();
});

test("keeps insertion available at tablet and phone widths", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(appPath("/"));
  await waitForStudio(page);
  await expect(page.locator(".mobile-candidate-actions .mobile-insert")).toBeVisible({ timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(page.getByLabel("Family view")).toBeVisible();
  await expect(page.getByLabel("Map view")).toBeVisible();
  await expect(page.getByLabel("List view")).toBeVisible();
  await expect(page.getByLabel("Rhyme adventurousness")).toBeVisible();
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
  const runtimeLink = page.getByRole("link", { name: /Web runtime licences/ });
  await expect(runtimeLink).toHaveAttribute("href", appPath("/licenses/Web-Runtime-Licences.txt"));
  const runtimeResponse = await page.request.get(appPath("/licenses/Web-Runtime-Licences.txt"));
  expect(runtimeResponse.ok()).toBeTruthy();
  const runtimeNotices = await runtimeResponse.text();
  expect(runtimeNotices).toContain("React and React DOM");
  expect(runtimeNotices).toContain("Next.js");
  expect(runtimeNotices).toContain("Lucide");
  expect(runtimeNotices).toContain("@huggingface/jinja");
});
