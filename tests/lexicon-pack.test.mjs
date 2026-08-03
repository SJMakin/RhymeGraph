import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRhymeEngine } from "../lib/phonetics/engine.ts";

const pack = JSON.parse(
  await readFile(new URL("../public/data/cmudict.compact.json", import.meta.url), "utf8"),
);

test("the production phrase pack contains only unique, word-bounded phrases", () => {
  const phraseNames = pack.phrases.map(([text]) => text);
  assert.equal(new Set(phraseNames).size, phraseNames.length);
  assert.ok(phraseNames.every((text) => text.includes(" ")));
  for (const [, pronunciations] of pack.phrases) {
    assert.ok(pronunciations.every((value) => value.wordStarts?.length >= 2));
  }
});

test("the shipped orange/door-hinge mosaic survives serialization", () => {
  const orange = pack.entries.find(([text]) => text === "orange");
  const doorHinge = pack.phrases.find(([text]) => text === "door hinge");
  assert.ok(orange && doorHinge);
  const engine = createRhymeEngine([
    { text: orange[0], pronunciations: orange[1] },
    { text: doorHinge[0], pronunciations: doorHinge[1], kind: "phrase" },
  ]);
  const result = engine.compare("orange", "door hinge");
  assert.ok(result);
  assert.ok(result.labels.includes("mosaic"));
  assert.ok(result.components.consonance > .65);
  assert.ok(result.components.phonetic > .55);
  assert.deepEqual(
    new Set(result.rightPronunciation.phonemes.map((phone) => phone.wordIndex)),
    new Set([0, 1]),
  );
});
