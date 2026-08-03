import { spawnSync } from "node:child_process";

const basePath = process.env.PAGES_BASE_PATH ?? "/RhymeGraph";
const siteOrigin = process.env.PAGES_SITE_ORIGIN ?? "https://sjmakin.github.io";
const npmCli = process.env.npm_execpath;
const env = {
  ...process.env,
  NEXT_PUBLIC_BASE_PATH: basePath,
  NEXT_PUBLIC_SITE_ORIGIN: siteOrigin,
  PLAYWRIGHT_BASE_PATH: basePath,
};

function run(args) {
  const command = npmCli ? process.execPath : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["run", "build"]);
if (process.argv.includes("--test")) run(["run", "test:browser:prod"]);
