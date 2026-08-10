import { defineConfig, devices } from "@playwright/test";

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "";
const rawExternalURL = process.env.RHYMEGRAPH_BENCHMARK_URL?.trim();

function normalizeExternalURL(value: string | undefined) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RHYMEGRAPH_BENCHMARK_URL must use HTTP or HTTPS.");
  }
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

const externalURL = normalizeExternalURL(rawExternalURL);
const baseURL = externalURL ?? `http://127.0.0.1:3191${basePath}/`;

if (externalURL) {
  const missingMetadata = [
    "RHYMEGRAPH_BENCHMARK_REVISION",
    "RHYMEGRAPH_BENCHMARK_LEXICON_VERSION",
  ].filter((name) => !process.env[name]?.trim());
  if (missingMetadata.length > 0) {
    throw new Error(
      `External benchmarks require explicit source metadata: ${missingMetadata.join(", ")}.`,
    );
  }
}

export default defineConfig({
  testDir: "./tests/benchmark",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  outputDir: "outputs/benchmark-test-results",
  reporter: [["line"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalURL
    ? undefined
    : {
        command: `npm run start -- --hostname 127.0.0.1 --port 3191${basePath ? ` --base-path ${basePath}` : ""} --cache-control public,max-age=3600`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium-benchmark",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
});
