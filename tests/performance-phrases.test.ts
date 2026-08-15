import assert from "node:assert/strict";
import test from "node:test";

import {
  composePerformancePhraseEntries,
  PERFORMANCE_PHRASE_TEXTS,
} from "../lib/phonetic-search/performance-phrases";
import { createRhymeEngine } from "../lib/phonetics";

test("composes authored phrase pronunciations with real word boundaries", () => {
  const entries = composePerformancePhraseEntries([
    { text: "night", pronunciations: ["N AY1 T"], frequency: .9 },
    { text: "fever", pronunciations: ["F IY1 V ER0"], frequency: .8 },
    { text: "light", pronunciations: ["L AY1 T"], frequency: .9 },
    { text: "sleeper", pronunciations: ["S L IY1 P ER0"], frequency: .7 },
  ]);
  assert.deepEqual(entries.map((entry) => entry.text), ["light sleeper", "night fever"]);
  assert.deepEqual(entries[0].pronunciations, [{
    phonemes: ["L", "AY1", "T", "S", "L", "IY1", "P", "ER0"],
    wordStarts: [0, 3],
  }]);
  assert.ok(entries.every((entry) => entry.tags?.includes("authored-performance-phrase")));

  const engine = createRhymeEngine([
    { text: "bright beaver", pronunciations: [{ phonemes: "B R AY1 T B IY1 V ER0", wordStarts: [0, 4] }], kind: "phrase" },
    ...entries,
  ]);
  const chain = engine.compare("bright beaver", "light sleeper");
  const shorter = engine.compare("bright beaver", "night fever");
  assert.ok(chain && shorter);
  assert.ok(chain.labels.includes("mosaic"));
});

test("keeps the authored phrase bank broad and duplicate-free", () => {
  assert.ok(PERFORMANCE_PHRASE_TEXTS.length >= 120);
  assert.equal(new Set(PERFORMANCE_PHRASE_TEXTS).size, PERFORMANCE_PHRASE_TEXTS.length);
  assert.ok(PERFORMANCE_PHRASE_TEXTS.includes("sports centre"));
  assert.ok(PERFORMANCE_PHRASE_TEXTS.includes("night fever"));
  assert.ok(PERFORMANCE_PHRASE_TEXTS.includes("light sleeper"));
});
