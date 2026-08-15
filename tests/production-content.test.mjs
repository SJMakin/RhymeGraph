import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { searchCandidateId } from "../lib/phonetic-search/protocol.ts";
import { createProductionEngine } from "./helpers/production-lexicon.mjs";

const AUDITED_REFERENCE_TERMS = [
  "dorchester",
  "malbec",
  "mayfair",
  "moncler",
  "shiraz",
  "sonnyjim",
  "vuvuzela",
];

// This is the reviewed subset that the current compact pack can pronounce.
// The build's broader UK wish-list also contains OOV forms, which should not be
// mistaken for shipped coverage until an audited pronunciation is available.
const AUDITED_UK_TERMS = [
  "bloke",
  "brum",
  "dorchester",
  "ends",
  "gaff",
  "geezer",
  "graft",
  "innit",
  "mandem",
  "mayfair",
  "peng",
  "roadman",
  "ting",
  "wagwan",
];

const indexingStarted = performance.now();
const { engine, inputs, pack } = await createProductionEngine();
const indexingMs = performance.now() - indexingStarted;
const packedEntries = new Map(pack.entries.map((entry) => [entry[0], entry]));

function countTags(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

function finalTailSignature(recommendation) {
  const phonemes = recommendation.pronunciation.phonemes;
  let finalVowel = -1;
  for (let index = phonemes.length - 1; index >= 0; index -= 1) {
    if (phonemes[index].type === "vowel") {
      finalVowel = index;
      break;
    }
  }
  return phonemes.slice(Math.max(0, finalVowel)).map(({ symbol }) => symbol).join(" ");
}

function assertUnitScore(value, description) {
  assert.ok(Number.isFinite(value), `${description} must be finite; received ${value}`);
  assert.ok(value >= 0 && value <= 1, `${description} must be in [0, 1]; received ${value}`);
}

function assertFiniteRecommendation(recommendation) {
  assertUnitScore(recommendation.score, `${recommendation.item.text} score`);
  assertUnitScore(recommendation.semantic, `${recommendation.item.text} semantic score`);
  assertUnitScore(recommendation.utility, `${recommendation.item.text} utility score`);
  for (const [component, value] of Object.entries(recommendation.family)) {
    assertUnitScore(value, `${recommendation.item.text} family.${component}`);
  }
  for (const comparison of recommendation.anchorComparisons) {
    for (const [component, value] of Object.entries(comparison.components)) {
      assertUnitScore(value, `${recommendation.item.text} comparison.${component}`);
    }
  }
}

test("the real compact lexicon preserves the audited UK and reference layers", (context) => {
  context.diagnostic(
    `indexed ${engine.items.length.toLocaleString()} production items in ${indexingMs.toFixed(1)} ms`,
  );
  assert.ok(pack.entries.length >= 50_000, `expected a broad pack, received ${pack.entries.length}`);
  assert.match(pack.dialect, /en-US/i);
  assert.match(pack.dialect, /en-GB/i);

  for (const [label, terms, flagName, tag] of [
    ["reference", AUDITED_REFERENCE_TERMS, "reference", "reference"],
    ["UK", AUDITED_UK_TERMS, "uk", "en-GB"],
  ]) {
    const flag = pack.entryFlags[flagName];
    assert.ok(Number.isInteger(flag) && flag > 0, `missing ${label} flag definition`);
    for (const term of terms) {
      const packed = packedEntries.get(term);
      assert.ok(packed, `audited ${label} term ${term} is missing from the compact pack`);
      assert.ok((packed[5] & flag) !== 0, `${term} lost its ${label} pack flag`);
      assert.ok(engine.represent(term)?.tags.includes(tag), `${term} lost its reconstructed ${tag} tag`);
    }
  }

  const reconstructedReferenceCount = inputs.filter(({ tags }) => tags.includes("reference")).length;
  const reconstructedUkCount = inputs.filter(({ tags }) => tags.includes("en-GB")).length;
  assert.ok(reconstructedReferenceCount >= AUDITED_REFERENCE_TERMS.length);
  assert.ok(reconstructedUkCount >= AUDITED_UK_TERMS.length);
  context.diagnostic(
    `audited ${AUDITED_REFERENCE_TERMS.length} reference and ${AUDITED_UK_TERMS.length} UK entries`,
  );
});

test("production search identities stay unique across word-boundary variants", () => {
  const ids = engine.items.map((item) => searchCandidateId(item.kind, item.normalized));
  assert.equal(new Set(ids).size, ids.length);
  for (const term of ["first-class", "first class", "last-minute", "last minute"]) {
    assert.ok(engine.represent(term), `${term} is missing from the collision regression`);
  }
  assert.notEqual(
    searchCandidateId("word", "first-class"),
    searchCandidateId("phrase", "first class"),
  );
});

test("production metadata remains useful for filters and commonness ranking", (context) => {
  const tags = countTags(inputs);
  const minimumUsefulCoverage = {
    noun: 10_000,
    verb: 4_000,
    adjective: 5_000,
    adverb: 1_000,
  };
  for (const [tag, minimum] of Object.entries(minimumUsefulCoverage)) {
    assert.ok((tags.get(tag) ?? 0) >= minimum, `${tag} coverage fell below ${minimum}`);
  }

  const runTags = engine.represent("run")?.tags ?? [];
  assert.ok(runTags.includes("noun"));
  assert.ok(runTags.includes("verb"));
  assert.ok(runTags.includes("spoken-corpus"));
  assert.ok(engine.represent("quick")?.tags.includes("adjective"));
  assert.ok(engine.represent("quick")?.tags.includes("adverb"));
  assert.ok(engine.represent("quickly")?.tags.includes("adverb"));
  assert.ok(engine.represent("door hinge")?.tags.includes("phrase"));

  const storedUtilities = pack.entries.map((entry) => entry[4]);
  assert.ok(storedUtilities.every((value) => Number.isInteger(value) && value >= 0 && value <= 1000));
  assert.ok(new Set(storedUtilities).size >= 250, "commonness metadata has collapsed into too few bands");
  assert.ok(Math.max(...storedUtilities) - Math.min(...storedUtilities) >= 500);

  const you = engine.represent("you");
  const malbec = engine.represent("malbec");
  const love = engine.represent("love");
  const pilfer = engine.represent("pilfer");
  assert.ok(you && malbec && love && pilfer);
  assert.ok(you.frequency - malbec.frequency >= .3, "spoken/common words should outrank rare references");
  assert.ok(love.frequency - pilfer.frequency >= .3, "commonness should separate familiar and rare words");

  context.diagnostic(
    `POS coverage noun=${tags.get("noun")}, verb=${tags.get("verb")}, adjective=${tags.get("adjective")}, adverb=${tags.get("adverb")}; utility bands=${new Set(storedUtilities).size}`,
  );
});

test("silver and pilfer retain a labelled loose-rhyme relationship", () => {
  assert.ok(engine.represent("silver"), "silver is missing from the production pack");
  assert.ok(engine.represent("pilfer"), "pilfer is missing from the production pack");
  const comparison = engine.compare("silver", "pilfer");
  assert.ok(comparison);
  assert.ok(comparison.labels.includes("assonance"));
  assert.ok(comparison.labels.includes("consonance"));
  assert.ok(comparison.labels.includes("slant"));
  assert.ok(comparison.labels.includes("multi-syllabic"));
  assert.ok(!comparison.labels.includes("full-rhyme"));
  assert.ok(comparison.components.phonetic >= .8);
  assert.ok(comparison.components.phonetic < 1, "depth must not saturate an imperfect slant");
});

test("multisyllabic depth preserves score headroom and exact word suffixes", () => {
  const anatomy = engine.compare("anatomy", "academy");
  const imperfectMotion = engine.compare("motion", "showman");
  const exactMotion = engine.compare("motion", "locomotion");
  assert.ok(anatomy && imperfectMotion && exactMotion);

  assert.ok(anatomy.components.phonetic < 1);
  assert.ok(imperfectMotion.components.phonetic < 1);
  assert.ok(exactMotion.components.phonetic > imperfectMotion.components.phonetic);
  assert.ok(exactMotion.labels.includes("full-rhyme"));
});

test("indexed UK retrieval keeps voicing pairs and multi-beat place rhymes", () => {
  const retrieve = (anchor) => engine.recommend({
    anchors: [anchor],
    intent: "continue",
    reach: .25,
    dialect: "en-GB",
    minPhonetic: .1,
    limit: 25,
    weights: { sound: .92, meaning: 0, utility: .08 },
  }).map((candidate) => candidate.item.normalized);

  assert.ok(retrieve("silver").includes("pilfer"), "silver should retrieve the V/F loose-rhyme family");
  assert.ok(
    retrieve("dorchester").includes("orchestra"),
    "Dorchester should retrieve a cross-consonant multi-beat relationship",
  );
});

test("Tight stays score-sorted while Far is finite and materially diversified", (context) => {
  const exhaustiveCount = engine.items.filter(({ normalized }) => normalized !== "time").length;
  const tightStarted = performance.now();
  const tight = engine.recommend({
    anchors: ["time"],
    intent: "continue",
    reach: 0,
    candidatePool: "exhaustive",
    minPhonetic: 0,
    limit: engine.items.length,
  });
  const tightMs = performance.now() - tightStarted;

  const farStarted = performance.now();
  const far = engine.recommend({
    anchors: ["time"],
    intent: "continue",
    reach: 1,
    candidatePool: "exhaustive",
    minPhonetic: 0,
    limit: 64,
  });
  const farMs = performance.now() - farStarted;

  assert.equal(tight.length, exhaustiveCount, "the exhaustive Tight run did not score the full corpus");
  assert.equal(new Set(tight.map(({ item }) => item.normalized)).size, tight.length);
  for (let index = 0; index < tight.length; index += 1) {
    assertFiniteRecommendation(tight[index]);
    if (index > 0) {
      assert.ok(
        tight[index - 1].score >= tight[index].score,
        `ranking rose from ${tight[index - 1].score} to ${tight[index].score} at index ${index}`,
      );
    }
  }
  for (let index = 0; index < far.length; index += 1) {
    assertFiniteRecommendation(far[index]);
  }

  const sampleSize = 12;
  const tightTop = tight.slice(0, sampleSize);
  const farTop = far.slice(0, sampleSize);
  const tightWords = new Set(tightTop.map(({ item }) => item.normalized));
  const farWords = new Set(farTop.map(({ item }) => item.normalized));
  const overlap = [...tightWords].filter((word) => farWords.has(word));
  const tightFullRhymes = tightTop.filter(({ labels }) => labels.includes("full-rhyme")).length;
  const farFullRhymes = farTop.filter(({ labels }) => labels.includes("full-rhyme")).length;
  const tightMeanPhonetic = tightTop.reduce((sum, result) => sum + result.family.phonetic, 0) / sampleSize;
  const farMeanPhonetic = farTop.reduce((sum, result) => sum + result.family.phonetic, 0) / sampleSize;
  const tightTailFamilies = new Set(tightTop.map(finalTailSignature));
  const farTailFamilies = new Set(farTop.map(finalTailSignature));
  const farPhraseCount = far.slice(0, 40).filter(({ item }) => item.kind === "phrase").length;
  const farFunctionPileup = far.slice(0, 20)
    .filter(({ item }) => ["i", "my", "why", "by"].includes(item.normalized)).length;
  const farScoreInversions = far.slice(1)
    .filter((item, index) => far[index].score < item.score).length;

  assert.ok(overlap.length <= 4, `Tight/Far top-${sampleSize} overlap is ${overlap.length}`);
  assert.ok(tightFullRhymes >= 8, `Tight returned only ${tightFullRhymes} full rhymes`);
  assert.ok(farFullRhymes <= 4, `Far retained ${farFullRhymes} full rhymes`);
  assert.ok(tightMeanPhonetic - farMeanPhonetic >= .15);
  assert.ok(farTailFamilies.size >= 3, `Far exposed only ${farTailFamilies.size} final-tail families`);
  assert.ok(farTailFamilies.size > tightTailFamilies.size);
  assert.ok(farPhraseCount >= 4, `Far surfaced only ${farPhraseCount} first-40 phrases`);
  assert.ok(farFunctionPileup <= 2, `Far stacked ${farFunctionPileup} ultra-short function words`);

  const describe = (results) => results
    .slice(0, sampleSize)
    .map(({ family, item, score }) => `${item.text} ${score.toFixed(3)}/${family.phonetic.toFixed(3)}`)
    .join(", ");
  context.diagnostic(`Tight exhaustive ${tightMs.toFixed(1)} ms: ${describe(tight)}`);
  context.diagnostic(`Far exhaustive ${farMs.toFixed(1)} ms: ${describe(far)}`);
  context.diagnostic(
    `top-${sampleSize} overlap=${overlap.length}, final-tail families Tight=${tightTailFamilies.size}/Far=${farTailFamilies.size}, Far score inversions=${farScoreInversions}`,
  );
});
