import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerDirectory = new URL("../public/workers/", import.meta.url);

async function readWorker(relativePath) {
  return readFile(new URL(relativePath, workerDirectory), "utf8");
}

test("versioned workers are self-contained and match their current aliases", async () => {
  for (const name of ["phonetic.worker", "semantic.worker"]) {
    const [versioned, alias] = await Promise.all([
      readWorker(`${name}.v3.js`),
      readWorker(`${name}.js`),
    ]);

    assert.equal(alias, versioned, `${name}.js must alias the checked-in v3 worker`);
    assert.doesNotMatch(versioned, /from["']\.\/chunks\//);
  }
});

test("the currently deployed Pages worker's cached base-path import is retained", async () => {
  const compatibilityChunk = await readWorker("chunks/public-path-B_7tJUiL.js");

  assert.match(compatibilityChunk, /RhymeGraph/);
  assert.match(compatibilityChunk, /export\{t\}/);
});
