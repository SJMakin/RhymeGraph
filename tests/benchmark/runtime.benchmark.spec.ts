import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";

const REPORT_SCHEMA = "rhymegraph.browser-benchmark.v1";
const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "";
const appPath = (path: string) => `${basePath}${path}`;
const externalBenchmarkURL = normalizeExternalURL(process.env.RHYMEGRAPH_BENCHMARK_URL);
const benchmarkEntryURL = externalBenchmarkURL ?? appPath("/");

type RunPhase = "cold" | "repeat";

interface WindowResourceSummary {
  windowObservedRequests: number;
  windowObservedTransferBytes: number;
  windowObservedDecodedBytes: number;
  windowObservedSemanticRequests: number;
  windowObservedSemanticTransferBytes: number;
}

interface PlaywrightRequestSummary {
  httpRequestsStarted: number;
  httpRequestsFinished: number;
  httpRequestsFailed: number;
  httpRequestsStillInFlight: number;
  requestsWithSizes: number;
  requestsWithoutSizes: number;
  encodedResponseBodyBytes: number;
  responseHeaderBytes: number;
  semanticRequestsStarted: number;
  semanticRequestsFinished: number;
  semanticEncodedResponseBodyBytes: number;
  semanticResponseHeaderBytes: number;
}

interface ResourceSummary {
  window: WindowResourceSummary;
  playwright: PlaywrightRequestSummary;
}

interface RunMetrics {
  phase: RunPhase;
  domReadyMs: number;
  soundReadyMs: number;
  meaningReadyMs: number;
  combinedReadyMs: number;
  resources: ResourceSummary;
  rendererUsedJsHeapBytes?: number;
}

interface RecordedRequest {
  phase: RunPhase;
  semantic: boolean;
  finished: boolean;
  failed: boolean;
  sizes?: Awaited<ReturnType<Request["sizes"]>>;
}

function elapsed(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function normalizeExternalURL(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RHYMEGRAPH_BENCHMARK_URL must use HTTP or HTTPS.");
  }
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function isSemanticResource(url: string) {
  return /\/models\/|\/data\/semantic-index\.|semantic\.worker|\.onnx(?:$|\?)|\/workers\/assets\/.*\.(?:wasm|mjs)(?:$|\?)/.test(url);
}

class PlaywrightRequestRecorder {
  private activePhase?: RunPhase;
  private readonly records = new Map<Request, RecordedRequest>();
  private readonly pendingSizes = new Set<Promise<void>>();

  constructor(private readonly context: BrowserContext) {
    context.on("request", this.onRequest);
    context.on("requestfinished", this.onRequestFinished);
    context.on("requestfailed", this.onRequestFailed);
  }

  beginPhase(phase: RunPhase) {
    this.activePhase = phase;
  }

  snapshot(phase: RunPhase) {
    return this.summarizeRecords(phase);
  }

  async summarize(phase: RunPhase) {
    // Event callbacks register size promises synchronously. Yield once to include
    // requestfinished events delivered in the same task as the readiness signal.
    while (true) {
      await new Promise<void>((resolveReady) => setTimeout(resolveReady, 0));
      const pending = [...this.pendingSizes];
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
    return this.summarizeRecords(phase);
  }

  dispose() {
    this.context.off("request", this.onRequest);
    this.context.off("requestfinished", this.onRequestFinished);
    this.context.off("requestfailed", this.onRequestFailed);
  }

  private readonly onRequest = (request: Request) => {
    if (!this.activePhase || !/^https?:/i.test(request.url())) return;
    this.records.set(request, {
      phase: this.activePhase,
      semantic: isSemanticResource(request.url()),
      finished: false,
      failed: false,
    });
  };

  private readonly onRequestFinished = (request: Request) => {
    const record = this.records.get(request);
    if (!record) return;
    record.finished = true;
    const sizeTask = request.sizes()
      .then((sizes) => {
        record.sizes = sizes;
      })
      .catch(() => {
        // Keep the request count and expose the missing size in the summary.
      })
      .finally(() => {
        this.pendingSizes.delete(sizeTask);
      });
    this.pendingSizes.add(sizeTask);
  };

  private readonly onRequestFailed = (request: Request) => {
    const record = this.records.get(request);
    if (record) record.failed = true;
  };

  private summarizeRecords(phase: RunPhase): PlaywrightRequestSummary {
    const summary: PlaywrightRequestSummary = {
      httpRequestsStarted: 0,
      httpRequestsFinished: 0,
      httpRequestsFailed: 0,
      httpRequestsStillInFlight: 0,
      requestsWithSizes: 0,
      requestsWithoutSizes: 0,
      encodedResponseBodyBytes: 0,
      responseHeaderBytes: 0,
      semanticRequestsStarted: 0,
      semanticRequestsFinished: 0,
      semanticEncodedResponseBodyBytes: 0,
      semanticResponseHeaderBytes: 0,
    };

    for (const record of this.records.values()) {
      if (record.phase !== phase) continue;
      summary.httpRequestsStarted += 1;
      if (record.finished) summary.httpRequestsFinished += 1;
      if (record.failed) summary.httpRequestsFailed += 1;
      if (record.semantic) summary.semanticRequestsStarted += 1;
      if (record.semantic && record.finished) summary.semanticRequestsFinished += 1;
      if (!record.sizes) {
        if (record.finished || record.failed) summary.requestsWithoutSizes += 1;
        continue;
      }
      summary.requestsWithSizes += 1;
      // Chromium can expose negative sentinel values for cache-served response
      // sizes. They are not bytes and must not make aggregate totals negative.
      const responseBodyBytes = Math.max(0, record.sizes.responseBodySize);
      const responseHeaderBytes = Math.max(0, record.sizes.responseHeadersSize);
      summary.encodedResponseBodyBytes += responseBodyBytes;
      summary.responseHeaderBytes += responseHeaderBytes;
      if (record.semantic) {
        summary.semanticEncodedResponseBodyBytes += responseBodyBytes;
        summary.semanticResponseHeaderBytes += responseHeaderBytes;
      }
    }

    summary.httpRequestsStillInFlight = Math.max(
      0,
      summary.httpRequestsStarted - summary.httpRequestsFinished - summary.httpRequestsFailed,
    );

    return summary;
  }
}

function gitOutput(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function localSourceMetadata(url: string | undefined) {
  const gitRevision = gitOutput(["rev-parse", "HEAD"]);
  const githubRevision = process.env.GITHUB_SHA?.trim();
  const revision = gitRevision ?? githubRevision ?? "unknown";
  const revisionSource = gitRevision
    ? "git-head"
    : githubRevision
      ? "GITHUB_SHA environment variable"
      : "unavailable";
  const worktreeStatus = gitOutput(["status", "--porcelain", "--untracked-files=normal"]);
  const dirtyAtReportTime = worktreeStatus === undefined ? undefined : worktreeStatus.length > 0;
  const artifactLexicon = await readFile(resolve("out/data/cmudict.compact.json"));
  const sourceLexicon = await readFile(resolve("public/data/cmudict.compact.json"));
  const artifactSha256 = createHash("sha256").update(artifactLexicon).digest("hex");
  const sourceSha256 = createHash("sha256").update(sourceLexicon).digest("hex");
  const packed = JSON.parse(artifactLexicon.toString("utf8")) as {
    version?: unknown;
    entries?: unknown[];
    phrases?: unknown[];
  };
  const exportedIndex = await stat(resolve("out/index.html"));

  return {
    kind: "local-static-export",
    url: url ?? "http://127.0.0.1:3191/",
    revision: {
      value: revision,
      source: revisionSource,
      meaning: gitRevision
        ? dirtyAtReportTime
          ? "Base Git revision only; the working tree has uncommitted changes."
          : "Git revision of the working tree; export-to-revision identity was not independently verified."
        : "Fallback identifier only; no local Git HEAD was available and export identity was not verified.",
    },
    worktree: {
      dirtyAtReportTime,
      statusAvailable: worktreeStatus !== undefined,
    },
    build: {
      artifact: "out/",
      exportedIndexModifiedAt: exportedIndex.mtime.toISOString(),
      packageInvocation: process.env.npm_lifecycle_event ?? "direct-or-unknown",
      precedingBuildDeclaredByPackageScript:
        process.env.npm_lifecycle_event === "benchmark:browser",
      artifactFreshnessVerified: false,
      verifiedAgainstRevision: false,
      note:
        "npm run benchmark:browser rebuilds out/ before Playwright starts; direct Playwright runs may serve an older export.",
    },
    lexicon: {
      version: typeof packed.version === "string" ? packed.version : "unknown",
      entries: Array.isArray(packed.entries) ? packed.entries.length : undefined,
      phrases: Array.isArray(packed.phrases) ? packed.phrases.length : undefined,
      artifactSha256,
      workingTreeSourceSha256: sourceSha256,
      artifactMatchesWorkingTreeSource: artifactSha256 === sourceSha256,
      provenance: "Read from the locally served out/data/cmudict.compact.json artifact.",
    },
  };
}

function externalSourceMetadata() {
  if (!externalBenchmarkURL) return undefined;
  const revision = process.env.RHYMEGRAPH_BENCHMARK_REVISION?.trim();
  const lexiconVersion = process.env.RHYMEGRAPH_BENCHMARK_LEXICON_VERSION?.trim();
  if (!revision || !lexiconVersion) {
    throw new Error(
      "External benchmarks require RHYMEGRAPH_BENCHMARK_REVISION and RHYMEGRAPH_BENCHMARK_LEXICON_VERSION.",
    );
  }
  return {
    kind: "external-deployment",
    url: externalBenchmarkURL,
    revision: {
      value: revision,
      meaning: "Supplied explicitly by the benchmark operator; not inferred from the local checkout.",
    },
    lexicon: {
      version: lexiconVersion,
      provenance: "Supplied explicitly by the benchmark operator; no local lexicon metadata was used.",
    },
  };
}

async function summarizeWindowResources(page: Page): Promise<WindowResourceSummary> {
  return page.evaluate(() => {
    const resources = globalThis.performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const isSemantic = (name: string) =>
      /\/models\/|semantic\.worker|\.onnx(?:$|\?)|\/workers\/assets\/.*\.(?:wasm|mjs)(?:$|\?)/.test(name);
    return resources.reduce<WindowResourceSummary>(
      (summary, resource) => {
        summary.windowObservedRequests += 1;
        summary.windowObservedTransferBytes += resource.transferSize || 0;
        summary.windowObservedDecodedBytes += resource.decodedBodySize || 0;
        if (isSemantic(resource.name)) {
          summary.windowObservedSemanticRequests += 1;
          summary.windowObservedSemanticTransferBytes += resource.transferSize || 0;
        }
        return summary;
      },
      {
        windowObservedRequests: 0,
        windowObservedTransferBytes: 0,
        windowObservedDecodedBytes: 0,
        windowObservedSemanticRequests: 0,
        windowObservedSemanticTransferBytes: 0,
      },
    );
  });
}

async function rendererHeap(page: Page) {
  return page.evaluate(() => {
    const memory = (globalThis.performance as unknown as {
      memory?: { usedJSHeapSize?: number };
    }).memory;
    return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : undefined;
  });
}

async function waitForMeaningReady(page: Page, startedAt: number) {
  const semanticEngine = page.locator(".semantic-engine[data-semantic-state]").first();
  await expect(semanticEngine).toHaveAttribute("data-semantic-state", /^(?:ready|error)$/);
  const state = await semanticEngine.getAttribute("data-semantic-state");
  if (state === "error") {
    const label = (await semanticEngine.textContent())?.trim() || "meaning unavailable";
    throw new Error(
      `Semantic model entered its error state (${label}) before becoming ready; inspect the retained trace for the failed model or WASM request.`,
    );
  }
  return elapsed(startedAt);
}

async function runLoad(
  page: Page,
  phase: RunMetrics["phase"],
  requestRecorder: PlaywrightRequestRecorder,
): Promise<RunMetrics> {
  requestRecorder.beginPhase(phase);
  const startedAt = performance.now();
  await page.goto(benchmarkEntryURL, { waitUntil: "domcontentloaded" });
  const domReadyMs = elapsed(startedAt);

  const soundReady = page.getByText(/[0-9]{2,3},[0-9]{3} terms local/)
    .waitFor({ state: "visible" })
    .then(() => elapsed(startedAt));
  let meaningReady = phase === "repeat"
    ? waitForMeaningReady(page, startedAt)
    : undefined;
  let combinedReady = phase === "repeat"
    ? page.locator(".engine-status").getByText(/^Sound \+ meaning searched across [\d,]+ local terms$/)
      .waitFor({ state: "visible" })
      .then(() => elapsed(startedAt))
    : undefined;
  const soundReadyMs = await soundReady;

  if (phase === "cold") {
    const beforeOptIn = requestRecorder.snapshot(phase);
    expect(
      beforeOptIn.semanticRequestsStarted,
      "sound-only startup must not request semantic assets, including from workers",
    ).toBe(0);
    const beforeOptInWindow = await summarizeWindowResources(page);
    expect(beforeOptInWindow.windowObservedSemanticRequests).toBe(0);
    meaningReady = waitForMeaningReady(page, startedAt);
    combinedReady = page.locator(".engine-status").getByText(/^Sound \+ meaning searched across [\d,]+ local terms$/)
      .waitFor({ state: "visible" })
      .then(() => elapsed(startedAt));
    await page.getByRole("button", { name: "Enable meaning" }).click();
  }

  const [meaningReadyMs, combinedReadyMs] = await Promise.all([
    meaningReady!,
    combinedReady!,
  ]);

  return {
    phase,
    domReadyMs,
    soundReadyMs,
    meaningReadyMs,
    combinedReadyMs,
    resources: {
      window: await summarizeWindowResources(page),
      playwright: await requestRecorder.summarize(phase),
    },
    rendererUsedJsHeapBytes: await rendererHeap(page),
  };
}

test("records cold and repeat on-device engine readiness", async ({ page, browserName, baseURL }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("rhymegraph-benchmark-started")) {
      localStorage.clear();
      sessionStorage.setItem("rhymegraph-benchmark-started", "true");
    }
  });

  const requestRecorder = new PlaywrightRequestRecorder(page.context());
  const cold = await runLoad(page, "cold", requestRecorder);
  const repeat = await runLoad(page, "repeat", requestRecorder);
  requestRecorder.dispose();
  const browserVersion = page.context().browser()?.version() ?? "unknown";
  const cpu = cpus()[0];
  const source = externalSourceMetadata() ?? await localSourceMetadata(baseURL);
  const report = {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    source,
    environment: {
      platform: platform(),
      release: release(),
      node: process.version,
      browser: browserName,
      browserVersion,
      cpu: cpu
        ? { model: cpu.model, speedMHz: cpu.speed, logicalProcessors: cpus().length }
        : undefined,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtReport: freemem(),
      headless: true,
      localServerCacheControl: externalBenchmarkURL
        ? undefined
        : "public,max-age=3600",
      notes: [
        "Renderer heap excludes WASM linear memory and browser-process overhead.",
        "Window resource fields come from PerformanceResourceTiming and exclude DedicatedWorker model/WASM fetches.",
        "Playwright encoded-response-body and header byte fields include finished HTTP requests observed at BrowserContext level, including worker requests. They exclude connection/TLS overhead and are not wire-transfer totals; cache-served responses may report zero or encoded resource size depending on the browser.",
      ],
    },
    protocol: {
      runs: 2,
      firstRun: "fresh browser context with cleared site storage",
      repeatRun: "same context and HTTP cache; remembered meaning preference",
      resourceAccounting:
        "Both window PerformanceResourceTiming and BrowserContext request.sizes(); requests are assigned to cold/repeat at request start using the active phase boundary.",
      productionBudgetsAreEnforced: false,
    },
    runs: [cold, repeat],
  };

  await mkdir(resolve("outputs"), { recursive: true });
  const reportPath = resolve("outputs/browser-benchmark.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Browser benchmark written to ${reportPath}`);
  console.log(
    `cold sound=${cold.soundReadyMs}ms meaning=${cold.meaningReadyMs}ms; ` +
      `repeat sound=${repeat.soundReadyMs}ms meaning=${repeat.meaningReadyMs}ms`,
  );

  expect(cold.resources.playwright.semanticRequestsStarted).toBeGreaterThan(0);
  expect(repeat.resources.playwright.semanticRequestsStarted).toBeGreaterThan(0);
});
