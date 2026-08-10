import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseURL || "http://localhost:3000";
const crossBrowser = process.env.PLAYWRIGHT_CROSS_BROWSER === "1";
const projects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } },
  },
  ...(crossBrowser
    ? [
        {
          name: "firefox-core",
          grep: /@cross-browser/,
          use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 960 } },
        },
        {
          name: "webkit-core",
          grep: /@cross-browser/,
          use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 960 } },
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
  outputDir: "outputs/test-results",
  reporter: [["line"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects,
});
