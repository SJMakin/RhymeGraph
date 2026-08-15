import { spawnSync } from "node:child_process";

const workerPathspec = "public/workers";

const diff = spawnSync(
  "git",
  ["diff", "--quiet", "--", workerPathspec],
  { stdio: "inherit" },
);

if (diff.error) throw diff.error;
if (diff.status !== 0) {
  throw new Error("Checked-in worker artifacts differ from a fresh root build.");
}

const untracked = spawnSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", workerPathspec],
  { encoding: "utf8" },
);

if (untracked.error) throw untracked.error;
if (untracked.status !== 0) {
  throw new Error("Could not inspect generated worker artifacts.");
}

const untrackedPaths = untracked.stdout.trim();
if (untrackedPaths) {
  throw new Error(`Fresh worker build produced untracked artifacts:\n${untrackedPaths}`);
}

console.log("Checked-in worker artifacts match a fresh root build.");
