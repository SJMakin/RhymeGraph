import assert from "node:assert/strict";
import test from "node:test";

import { createRhymeEngine } from "../lib/phonetics/engine.ts";
import { DEMO_LEXICON } from "../lib/phonetics/demo-lexicon.ts";

const engine = createRhymeEngine(DEMO_LEXICON);

function comparison(left, right) {
  const result = engine.compare(left, right);
  assert.ok(result, `Expected a comparison for ${left}/${right}`);
  return result;
}

test("represents words and composed phrases with stress and word boundaries", () => {
  const word = engine.represent("divine");
  const phrase = engine.represent("door hinge");
  assert.ok(word && phrase);
  assert.deepEqual(word.pronunciations[0].stressPattern, [0, 1]);
  assert.equal(phrase.kind, "phrase");
  assert.equal(phrase.pronunciations[0].syllableCount, 2);
  assert.deepEqual(new Set(phrase.pronunciations[0].phonemes.map((phone) => phone.wordIndex)), new Set([0, 1]));
});

test("recognises a shared time/mine/divine family", () => {
  assert.ok(comparison("time", "mine").components.phonetic > .75);
  assert.ok(comparison("mine", "divine").components.assonance > .9);
  const recommendations = engine.recommend({ anchors: ["time", "mine"], intent: "continue", limit: 10 });
  const divine = recommendations.find((item) => item.item.normalized === "divine");
  assert.ok(divine);
  assert.ok(divine.family.weakest > .7);
  assert.match(divine.explanation.join(" "), /all 2 anchors/i);
});

test("keeps assonance and consonance as distinct evidence", () => {
  const loveMove = comparison("love", "move");
  assert.ok(loveMove.components.coda > .95);
  assert.ok(loveMove.components.assonance < .5);
  assert.ok(loveMove.labels.includes("consonance"));
  assert.ok(loveMove.labels.includes("slant"));

  const handBond = comparison("hand", "bond");
  assert.ok(handBond.components.coda > .95);
  assert.ok(handBond.components.assonance > .3 && handBond.components.assonance < .75);
  assert.ok(handBond.components.phonetic > .55);
});

test("does not confuse rhotic and central vowels as a full rhyme", () => {
  const custom = createRhymeEngine([
    { text: "love", pronunciations: ["L AH1 V"] },
    { text: "serve", pronunciations: ["S ER1 V"] },
  ]);
  const result = custom.compare("love", "serve");
  assert.ok(result);
  assert.ok(result.components.assonance < .6);
  assert.equal(result.labels.includes("full-rhyme"), false);
  assert.ok(result.labels.includes("consonance"));
});

test("aligns dropped syllables in violence/silence", () => {
  const result = comparison("violence", "silence");
  assert.ok(result.components.assonance > .6);
  assert.ok(result.components.consonance > .7);
  assert.ok(result.labels.includes("multi-syllabic"));
  assert.ok(result.components.phonetic > comparison("violence", "table").components.phonetic);
});

test("finds mosaic rhyme across the orange/door hinge boundary", () => {
  const result = comparison("orange", "door hinge");
  assert.ok(result.labels.includes("mosaic"));
  assert.ok(result.components.consonance > .65);
  assert.ok(result.components.phonetic > .55);
});

test("does not promote obvious initial-sound and unrelated false positives", () => {
  const trueNeighbour = comparison("time", "mine").components.phonetic;
  const sameInitialOnly = comparison("time", "table").components.phonetic;
  const unrelated = comparison("cat", "dog").components.phonetic;
  assert.ok(trueNeighbour - sameInitialOnly > .35);
  assert.ok(unrelated < .45);
  assert.equal(engine.recommend({ anchors: ["cat"], intent: "continue", limit: 30 }).some((item) => item.item.normalized === "dog"), false);
  const tight = engine.recommend({ anchors: ["time"], intent: "continue", minPhonetic: .6, limit: 30 });
  assert.equal(tight.some((item) => item.item.normalized === "table"), false);
});

test("Continue, Bridge and Pivot produce deterministic intent-aware rankings", () => {
  const semanticScores = { silence: 1, quiet: .95, divine: .1, mine: .1 };
  const continueResults = engine.recommend({ anchors: ["violence"], intent: "continue", semanticScores, limit: 8 });
  const bridgeResults = engine.recommend({ anchors: ["violence"], intent: "bridge", semanticScores, limit: 8 });
  const pivotResults = engine.recommend({ anchors: ["time"], intent: "pivot", limit: 8 });
  assert.equal(continueResults[0].item.normalized, "silence");
  assert.equal(bridgeResults[0].item.normalized, "silence");
  assert.ok(bridgeResults[0].labels.includes("semantic-bridge"));
  assert.ok(pivotResults.every((item) => item.labels.includes("sound-pivot")));
  assert.deepEqual(
    engine.recommend({ anchors: ["time", "mine"], intent: "continue", limit: 8 }),
    engine.recommend({ anchors: ["time", "mine"], intent: "continue", limit: 8 }),
  );
});

test("accepts an injected lexicon and handles unknowns without guessing", () => {
  const custom = createRhymeEngine([
    { text: "glow", pronunciations: ["G L OW1"] },
    { text: "snow", pronunciations: ["S N OW1"] },
  ]);
  assert.ok(custom.compare("glow", "snow").components.assonance > .95);
  assert.equal(custom.represent("unknown"), undefined);
  assert.deepEqual(custom.recommend({ anchors: ["unknown"], intent: "continue" }), []);
});

test("uses one candidate pronunciation across a pinned rhyme family", () => {
  const custom = createRhymeEngine([
    { text: "flow", pronunciations: ["F L OW1"] },
    { text: "now", pronunciations: ["N AW1"] },
    { text: "bow", pronunciations: ["B AW1", "B OW1"] },
  ]);

  const singleAnchor = custom.recommend({ anchors: ["flow"], intent: "continue", limit: 5 });
  const bowForFlow = singleAnchor.find((item) => item.item.normalized === "bow");
  assert.equal(bowForFlow?.pronunciation.source, "B OW1");

  const family = custom.recommend({ anchors: ["flow", "now"], intent: "continue", limit: 5 });
  const bow = family.find((item) => item.item.normalized === "bow");
  assert.ok(bow);
  assert.ok(bow.family.weakest < .8);
  assert.deepEqual(
    new Set(bow.anchorComparisons.map((comparison) => comparison.rightPronunciation.source)),
    new Set([bow.pronunciation.source]),
  );
});
