import assert from "node:assert/strict";
import test from "node:test";

import { createRhymeEngine } from "../lib/phonetics/engine.ts";
import { DEMO_LEXICON } from "../lib/phonetics/demo-lexicon.ts";
import { createRhymeRetrievalIndex } from "../lib/phonetics/retrieval.ts";

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

test("does not invent consonance when both rhyme tails are open vowels", () => {
  const custom = createRhymeEngine([
    { text: "flow", pronunciations: ["F L OW1"] },
    { text: "go", pronunciations: ["G OW1"] },
    { text: "yeah", pronunciations: ["Y AE1"] },
  ]);
  const exact = custom.compare("flow", "go");
  const mismatch = custom.compare("flow", "yeah");
  assert.ok(exact && mismatch);

  assert.equal(exact.components.consonance, 0);
  assert.equal(exact.components.coda, 0);
  assert.ok(exact.components.phonetic > .95);
  assert.ok(exact.labels.includes("full-rhyme"));
  assert.equal(exact.labels.includes("consonance"), false);
  assert.doesNotMatch(exact.explanation.join(" "), /consonant/i);

  assert.ok(mismatch.components.phonetic < .45);
  assert.equal(mismatch.labels.includes("consonance"), false);
  assert.equal(mismatch.labels.includes("slant"), false);
  assert.doesNotMatch(mismatch.explanation.join(" "), /consonant/i);
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

test("rewards an extended phrase chain without treating its final word as the whole rhyme", () => {
  const custom = createRhymeEngine([
    { text: "bright beaver", pronunciations: [{ phonemes: "B R AY1 T B IY1 V ER0", wordStarts: [0, 4] }], kind: "phrase" },
    { text: "light sleeper", pronunciations: [{ phonemes: "L AY1 T S L IY1 P ER0", wordStarts: [0, 4] }], kind: "phrase" },
    { text: "beaver", pronunciations: ["B IY1 V ER0"] },
  ]);
  const chain = custom.compare("bright beaver", "light sleeper");
  const suffixOnly = custom.compare("bright beaver", "beaver");
  assert.ok(chain && suffixOnly);
  assert.ok(chain.components.phonetic > suffixOnly.components.phonetic);
  assert.deepEqual(chain.matchedSpan.left, [2, 8]);
  assert.deepEqual(chain.matchedSpan.right, [1, 8]);
  assert.ok(chain.labels.includes("mosaic"));
  assert.equal(suffixOnly.labels.includes("full-rhyme"), false);
  assert.equal(suffixOnly.labels.includes("mosaic"), false);
  assert.ok(suffixOnly.components.coverage < chain.components.coverage);
});

test("keeps a voiced medial mismatch out of the full-rhyme class", () => {
  const custom = createRhymeEngine([
    { text: "silver", pronunciations: ["S IH1 L V ER0"] },
    { text: "pilfer", pronunciations: ["P IH1 L F ER0"] },
  ]);
  const result = custom.compare("silver", "pilfer");
  assert.ok(result);
  assert.equal(result.labels.includes("full-rhyme"), false);
  assert.ok(result.labels.includes("slant"));
});

test("keeps inverted word stress below a full rhyme and explains the mismatch", () => {
  const custom = createRhymeEngine([
    { text: "below", pronunciations: ["B IH0 L OW1"] },
    { text: "billow", pronunciations: ["B IH1 L OW0"] },
  ]);
  const result = custom.compare("below", "billow");
  assert.ok(result);
  assert.equal(result.components.stress, .25);
  assert.ok(result.components.phonetic < .9);
  assert.equal(result.labels.includes("full-rhyme"), false);
  assert.ok(result.labels.includes("slant"));
  assert.doesNotMatch(result.explanation.join(" "), /strong stressed-vowel/i);
  assert.match(result.explanation.join(" "), /emphasis falls differently/i);
});

test("reach changes Continue ranking rather than only lowering a cutoff", () => {
  const custom = createRhymeEngine([
    { text: "flame", pronunciations: ["F L EY1 M"] },
    { text: "frame", pronunciations: ["F R EY1 M"], frequency: .7 },
    { text: "plain", pronunciations: ["P L EY1 N"], frequency: .7 },
    { text: "late", pronunciations: ["L EY1 T"], frequency: .7 },
    { text: "foam", pronunciations: ["F OW1 M"], frequency: .7 },
  ]);
  const tight = custom.recommend({ anchors: ["flame"], intent: "continue", reach: 0, minPhonetic: 0, limit: 4 });
  const wild = custom.recommend({ anchors: ["flame"], intent: "continue", reach: 1, minPhonetic: 0, limit: 4 });
  assert.equal(tight[0].item.normalized, "frame");
  assert.notDeepEqual(wild.map((item) => item.item.normalized), tight.map((item) => item.item.normalized));
  assert.notEqual(wild[0].item.normalized, "frame");
});

test("reach changes Bridge ranking after sound fusion", () => {
  const custom = createRhymeEngine([
    { text: "flame", pronunciations: ["F L EY1 M"] },
    { text: "frame", pronunciations: ["F R EY1 M"], frequency: .7 },
    { text: "plain", pronunciations: ["P L EY1 N"], frequency: .7 },
    { text: "late", pronunciations: ["L EY1 T"], frequency: .7 },
    { text: "foam", pronunciations: ["F OW1 M"], frequency: .7 },
  ]);
  const request = {
    anchors: ["flame"],
    intent: "bridge",
    minPhonetic: 0,
    limit: 4,
    weights: { sound: 1, meaning: 0, utility: 0 },
  };
  const tight = custom.recommend({ ...request, reach: 0 });
  const wild = custom.recommend({ ...request, reach: 1 });
  assert.equal(tight[0].item.normalized, "frame");
  assert.equal(wild[0].item.normalized, "late");
  assert.notDeepEqual(wild.map((item) => item.item.normalized), tight.map((item) => item.item.normalized));
});

test("Pivot starts in a neighbouring family rather than duplicating Continue", () => {
  const custom = createRhymeEngine([
    { text: "time", pronunciations: ["T AY1 M"] },
    { text: "mine", pronunciations: ["M AY1 N"] },
    { text: "life", pronunciations: ["L AY1 F"] },
    { text: "light", pronunciations: ["L AY1 T"] },
    { text: "late", pronunciations: ["L EY1 T"] },
    { text: "flame", pronunciations: ["F L EY1 M"] },
    { text: "frame", pronunciations: ["F R EY1 M"] },
    { text: "plain", pronunciations: ["P L EY1 N"] },
  ]);
  const request = {
    intent: "pivot",
    reach: 0,
    minPhonetic: 0,
    limit: 8,
    weights: { sound: 1, meaning: 0, utility: 0 },
  };
  const time = custom.recommend({ ...request, anchors: ["time"] })
    .map((item) => item.item.normalized);
  const flame = custom.recommend({ ...request, anchors: ["flame"] })
    .map((item) => item.item.normalized);

  assert.ok(time.indexOf("life") < time.indexOf("mine"));
  assert.ok(time.indexOf("light") < time.indexOf("mine"));
  assert.notEqual(flame[0], "frame");
  assert.ok(flame.indexOf("plain") < flame.indexOf("frame"));
});

test("indexed recommendations preserve representative exhaustive top results", () => {
  const queries = [
    { anchors: ["time"], intent: "continue", reach: 0 },
    { anchors: ["violence"], intent: "bridge", reach: 1 },
    { anchors: ["time", "mine"], intent: "pivot", reach: .7 },
  ];
  for (const query of queries) {
    const request = {
      ...query,
      minPhonetic: 0,
      limit: 10,
      weights: { sound: 1, meaning: 0, utility: 0 },
    };
    const indexed = engine.recommend(request).map((item) => item.item.normalized);
    const exhaustive = engine.recommend({ ...request, candidatePool: "exhaustive" })
      .map((item) => item.item.normalized);
    assert.deepEqual(indexed, exhaustive, `${query.intent}: ${query.anchors.join("+")}`);
  }
});

test("retrieval stays bounded, broadens with reach, and unions semantic-only terms", () => {
  const fillers = Array.from({ length: 2_000 }, (_, index) => ({
    text: `filler-${String(index).padStart(4, "0")}`,
    pronunciations: ["B AA1 K"],
    frequency: .9 - index / 10_000,
  }));
  const custom = createRhymeEngine([
    { text: "time", pronunciations: ["T AY1 M"], frequency: 1 },
    { text: "mine", pronunciations: ["M AY1 N"], frequency: 1 },
    { text: "divine", pronunciations: ["D IH0 V AY1 N"], frequency: .7 },
    { text: "semantic-only", pronunciations: ["S IY0 M AE1 N T IH0 K UW1 Z"], frequency: .01 },
    { text: "quiet water", pronunciations: [{ phonemes: "K W AY1 AH0 T W AO1 T ER0", wordStarts: [0, 5] }], kind: "phrase", frequency: .01 },
    { text: "blue weather", pronunciations: [{ phonemes: "B L UW1 W EH1 DH ER0", wordStarts: [0, 3] }], kind: "phrase", frequency: .01 },
    ...fillers,
  ]);
  const retrieval = createRhymeRetrievalIndex(custom.items);
  const anchors = [custom.represent("time"), custom.represent("mine")];
  assert.ok(anchors.every(Boolean));
  const tight = retrieval.shortlist({ anchors, reach: 0 });
  const wild = retrieval.shortlist({ anchors, reach: 1 });
  assert.ok(tight.length < wild.length);
  assert.ok(wild.length < custom.items.length);
  assert.ok(tight.some((item) => item.normalized === "divine"));
  assert.equal(tight.some((item) => item.normalized === "semantic-only"), false);
  assert.deepEqual(
    tight.filter((item) => item.kind === "phrase").map((item) => item.normalized).sort(),
    ["blue weather", "quiet water"],
  );
  const semanticUnion = retrieval.shortlist({
    anchors,
    reach: 0,
    semanticTerms: ["semantic-only"],
  });
  assert.ok(semanticUnion.some((item) => item.normalized === "semantic-only"));

  const recommendations = custom.recommend({
    anchors: ["time", "mine"],
    intent: "bridge",
    minPhonetic: 0,
    limit: 1,
    semanticScores: { "semantic-only": 1 },
    weights: { sound: 0, meaning: 1, utility: 0 },
  });
  assert.equal(recommendations[0].item.normalized, "semantic-only");
});

test("adventurous results diversify tail families and reserve useful phrase slots", () => {
  const words = [
    ["my", "M AY1"], ["why", "W AY1"], ["by", "B AY1"], ["i", "AY1"],
    ["guy", "G AY1"], ["hi", "HH AY1"], ["try", "T R AY1"],
    ["like", "L AY1 K"], ["tide", "T AY1 D"], ["kind", "K AY1 N D"],
    ["life", "L AY1 F"], ["light", "L AY1 T"], ["lime", "L AY1 M"],
    ["line", "L AY1 N"], ["foam", "F OW1 M"], ["late", "L EY1 T"],
    ["hand", "HH AE1 N D"], ["love", "L AH1 V"], ["move", "M UW1 V"],
    ["dove", "D AH1 V"], ["road", "R OW1 D"], ["rain", "R EY1 N"],
  ].map(([text, pronunciation]) => ({ text, pronunciations: [pronunciation], frequency: .7 }));
  const phrases = [
    ["night ride", "N AY1 T R AY1 D", 3],
    ["bright line", "B R AY1 T L AY1 N", 4],
    ["wide eyes", "W AY1 D AY1 Z", 3],
    ["right time", "R AY1 T T AY1 M", 3],
  ].map(([text, phonemes, wordStart]) => ({
    text,
    pronunciations: [{ phonemes, wordStarts: [0, wordStart] }],
    kind: "phrase",
    frequency: .4,
  }));
  const custom = createRhymeEngine([
    { text: "time", pronunciations: ["T AY1 M"] },
    ...words,
    ...phrases,
  ]);
  const request = {
    anchors: ["time"],
    intent: "continue",
    reach: 1,
    minPhonetic: 0,
    limit: 40,
    weights: { sound: 1, meaning: 0, utility: 0 },
  };
  const results = custom.recommend(request);
  const signatures = results.slice(0, 20).map((item) => {
    const phones = item.pronunciation.phonemes;
    const vowelIndex = phones.findLastIndex((phone) => phone.type === "vowel");
    return `${phones[vowelIndex].symbol}|${phones.slice(vowelIndex + 1).map((phone) => phone.symbol).join("-")}`;
  });
  assert.ok(new Set(signatures).size >= 8);
  assert.ok(results.slice(0, 20).filter((item) => ["i", "my", "why", "by"].includes(item.item.normalized)).length <= 2);
  assert.equal(results.slice(0, 40).filter((item) => item.item.kind === "phrase").length, 4);
  assert.deepEqual(results, custom.recommend(request));
});

test("en-GB performance scoring supports non-rhotic and Dorchester-family rhymes", () => {
  const custom = createRhymeEngine([
    { text: "spa", pronunciations: ["S P AA1"] },
    { text: "bar", pronunciations: ["B AA1 R"] },
    { text: "bird", pronunciations: ["B ER1 D"] },
    { text: "bud", pronunciations: ["B AH1 D"] },
    { text: "serve", pronunciations: ["S ER1 V"] },
    { text: "love", pronunciations: ["L AH1 V"] },
    { text: "dorchester", pronunciations: ["D AO1 R CH EH2 S T ER0"] },
    { text: "orchestra", pronunciations: ["AO1 R K AH0 S T R AH0"] },
  ]);
  const base = {
    intent: "continue",
    minPhonetic: 0,
    limit: 4,
    weights: { sound: 1, meaning: 0, utility: 0 },
  };
  const usBar = custom.recommend({ ...base, anchors: ["spa"], dialect: "en-US" })
    .find((item) => item.item.normalized === "bar");
  const gbBar = custom.recommend({ ...base, anchors: ["spa"], dialect: "en-GB" })
    .find((item) => item.item.normalized === "bar");
  assert.ok(usBar && gbBar);
  assert.ok(gbBar.family.phonetic > usBar.family.phonetic + .3);
  assert.equal(gbBar.family.phonetic, 1);
  assert.equal(gbBar.pronunciation.source, "B AA1");
  assert.equal(gbBar.anchorComparisons[0].rightPronunciation.source, "B AA1");
  assert.equal(custom.compare("spa", "bar").components.phonetic, usBar.family.phonetic);

  for (const [left, right] of [["bird", "bud"], ["serve", "love"]]) {
    const result = custom.recommend({ ...base, anchors: [left], dialect: "en-GB" })
      .find((item) => item.item.normalized === right);
    assert.ok(result);
    assert.ok(result.family.phonetic < .9, `${left}/${right} must keep NURSE distinct from STRUT`);
    assert.ok(!result.labels.includes("full-rhyme"));
    assert.match(result.anchorComparisons[0].leftPronunciation.source, /ER1/);
  }

  const gbOrchestra = custom.recommend({ ...base, anchors: ["dorchester"], dialect: "en-GB" })
    .find((item) => item.item.normalized === "orchestra");
  assert.ok(gbOrchestra);
  assert.match(gbOrchestra.anchorComparisons[0].leftPronunciation.source, /AO1 CH/);
  assert.match(gbOrchestra.anchorComparisons[0].leftPronunciation.source, /AH0$/);
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
  assert.deepEqual(
    custom.recommend({ anchors: ["unknown", "glow"], intent: "continue" }),
    [],
    "a mixed known/OOV family must not silently ignore its unknown anchor",
  );
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

test("ignores inherited or non-finite semantic scores and keeps rankings ordered", () => {
  const custom = createRhymeEngine([
    { text: "anchor", pronunciations: ["AE1 N K ER0"], frequency: .7 },
    { text: "answer", pronunciations: ["AE1 N S ER0"], frequency: .9 },
    { text: "constructor", pronunciations: ["K AH0 N S T R AH1 K T ER0"], frequency: .4 },
    { text: "wander", pronunciations: ["W AA1 N D ER0"], frequency: .6 },
  ]);

  const semanticScores = Object.create({ constructor: 1 });
  semanticScores.answer = Number.NaN;
  const results = custom.recommend({
    anchors: ["anchor"],
    intent: "continue",
    minPhonetic: 0,
    semanticScores,
    limit: 10,
  });

  assert.equal(results.find((item) => item.item.normalized === "constructor")?.semantic, 0);
  assert.equal(results.find((item) => item.item.normalized === "answer")?.semantic, 0);
  assert.ok(results.every((item) => Number.isFinite(item.score)));
  assert.ok(results.every((item, index) => index === 0 || results[index - 1].score >= item.score));
});
