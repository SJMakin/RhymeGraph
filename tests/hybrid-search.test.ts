import assert from "node:assert/strict";
import test from "node:test";

import { createHybridSearchPolicy } from "../lib/search/hybrid";
import type { SemanticRetrievalHit } from "../lib/semantic/protocol";

const hit = (text: string, fusionScore: number): SemanticRetrievalHit => ({
  text,
  score: .99,
  fusionScore,
  cosine: fusionScore - .2,
  partOfSpeechMask: 1,
  senseCount: 1,
  utility: .6,
  flags: 0,
});

test("hybrid search uses fixed fusion strength without batch stretching", () => {
  const policy = createHybridSearchPolicy({
    intent: "bridge",
    meaningMix: 40,
    reach: .5,
    semanticHits: [hit("River Bank", .62), hit("constructor", .19)],
  });
  assert.equal(Object.getPrototypeOf(policy.semanticScores), null);
  assert.equal(policy.semanticScores["river bank"], .62);
  assert.equal(policy.semanticScores.constructor, .19);
  assert.deepEqual(policy.weights, { sound: .6, meaning: .4, utility: .12 });
});

test("reach opens retrieval while intent keeps a phonetic floor", () => {
  const close = createHybridSearchPolicy({
    intent: "continue",
    meaningMix: 20,
    reach: 0,
    semanticHits: [],
  });
  const wide = createHybridSearchPolicy({
    intent: "continue",
    meaningMix: 20,
    reach: 1,
    semanticHits: [],
  });
  const bridge = createHybridSearchPolicy({
    intent: "bridge",
    meaningMix: 60,
    reach: 1,
    semanticHits: [],
  });
  assert.ok(wide.minPhonetic < close.minPhonetic);
  assert.ok(bridge.minPhonetic > 0);
  assert.ok(bridge.weights.meaning > bridge.weights.sound);
});
