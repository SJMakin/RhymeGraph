import { defineConfig, devices } from "@playwright/test";

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "";
const baseURL = `http://127.0.0.1:3101${basePath}/`;
const crossBrowser = process.env.PLAYWRIGHT_CROSS_BROWSER === "1";
const projects = [
  {
    name: "chromium-production",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 960 },
    },
  },
  ...(crossBrowser
    ? [
        {
          name: "firefox-production-core",
          grep: /@cross-browser/,
          use: {
            ...devices["Desktop Firefox"],
            viewport: { width: 1440, height: 960 },
          },
        },
        {
          name: "webkit-production-core",
          grep: /@cross-browser/,
          use: {
            ...devices["Desktop Safari"],
            viewport: { width: 1440, height: 960 },
          },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "outputs/test-results-production",
  reporter: [["line"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port 3101${basePath ? ` --base-path ${basePath}` : ""}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects,
});
