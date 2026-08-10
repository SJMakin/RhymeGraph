import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createRhymeEngine, normalizeText } from "../lib/phonetics/engine.ts";

export const SCENARIO_SCHEMA_VERSION = "rhymegraph.evaluation-scenarios.v1";
export const EVALUATION_REPORT_VERSION = "rhymegraph.evaluation-report.v1";
export const BASELINE_ID = "stressed-vowel-suffix-v1";
export const CURRENT_ENGINE_ID = "rhymegraph-phonetic-v0.1";

export const DEFAULT_SCENARIO_URL = new URL("./scenarios.v1.json", import.meta.url);
export const DEFAULT_LEXICON_URL = new URL("../public/data/cmudict.compact.json", import.meta.url);
export const ENGINE_SOURCE_URL = new URL("../lib/phonetics/engine.ts", import.meta.url);
export const EVALUATOR_SOURCE_URL = new URL("./core.mjs", import.meta.url);

const INTENTS = new Set(["continue", "bridge", "pivot"]);
const GRADES = new Set([0, 1, 2]);
const CATEGORIES = new Set([
  "full-rhyme",
  "assonance",
  "consonance",
  "slant",
  "multi-syllabic",
  "mosaic",
  "multi-pin",
  "slang",
  "ambiguous-pronunciation",
  "pivot",
  "unknown-word",
]);
const RELATIONSHIPS = new Set([
  "full-rhyme",
  "assonance",
  "consonance",
  "slant",
  "multi-syllabic",
  "mosaic",
  "sound-pivot",
]);

function digest(contents) {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function round(value, places = 6) {
  if (value === null || !Number.isFinite(value)) return value;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function average(values) {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function rejectUnexpectedKeys(errors, value, allowed, path) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path} contains unsupported field ${key}.`);
  }
}

export function validateDataset(dataset) {
  const errors = [];
  if (!isPlainObject(dataset)) throw new Error("Evaluation dataset must be a JSON object.");
  rejectUnexpectedKeys(errors, dataset, new Set([
    "$schema", "schemaVersion", "datasetId", "datasetVersion", "split", "heldOut",
    "judgement", "provenance", "scenarios",
  ]), "dataset");

  pushIf(errors, dataset.schemaVersion !== SCENARIO_SCHEMA_VERSION,
    `schemaVersion must be ${SCENARIO_SCHEMA_VERSION}.`);
  pushIf(errors, typeof dataset.datasetId !== "string" || dataset.datasetId.trim() === "",
    "datasetId must be a non-empty string.");
  pushIf(errors, typeof dataset.datasetVersion !== "string" || dataset.datasetVersion.trim() === "",
    "datasetVersion must be a non-empty string.");
  pushIf(errors, dataset.split !== "development" && dataset.split !== "held-out",
    "split must be development or held-out.");
  pushIf(errors, typeof dataset.heldOut !== "boolean", "heldOut must be boolean.");
  pushIf(errors, dataset.heldOut !== (dataset.split === "held-out"),
    "heldOut must be true exactly when split is held-out.");
  pushIf(errors, !isPlainObject(dataset.judgement), "judgement must be an object.");
  if (isPlainObject(dataset.judgement)) {
    rejectUnexpectedKeys(errors, dataset.judgement,
      new Set(["scale", "reviewerCount", "reviewType", "status"]), "judgement");
    pushIf(errors,
      dataset.judgement.scale !== "0-unrelated_1-usable_2-keep-worthy",
      "judgement.scale is not the v1 0/1/2 scale.");
    pushIf(errors,
      !Number.isInteger(dataset.judgement.reviewerCount) || dataset.judgement.reviewerCount < 0,
      "judgement.reviewerCount must be a non-negative integer counting human reviewers.");
    pushIf(errors,
      !new Set(["unreviewed-machine-assisted", "human-reviewed"]).has(dataset.judgement.reviewType),
      "judgement.reviewType is unsupported.");
    pushIf(errors,
      !new Set(["provisional-development", "double-reviewed-frozen"]).has(dataset.judgement.status),
      "judgement.status is unsupported.");
    pushIf(errors,
      dataset.heldOut && dataset.judgement.status !== "double-reviewed-frozen",
      "A held-out dataset must be double-reviewed-frozen.");
    pushIf(errors,
      dataset.judgement.reviewType === "unreviewed-machine-assisted" &&
        dataset.judgement.reviewerCount !== 0,
      "Unreviewed machine-assisted fixtures must declare zero human reviewers.");
    pushIf(errors,
      dataset.judgement.reviewType === "unreviewed-machine-assisted" &&
        dataset.judgement.status !== "provisional-development",
      "Unreviewed machine-assisted fixtures must remain provisional development data.");
    pushIf(errors,
      dataset.judgement.reviewType === "human-reviewed" && dataset.judgement.reviewerCount < 1,
      "Human-reviewed data needs at least one human reviewer.");
    pushIf(errors,
      dataset.judgement.status === "double-reviewed-frozen" &&
        (dataset.judgement.reviewerCount < 2 || dataset.judgement.reviewType !== "human-reviewed"),
      "A double-reviewed-frozen dataset needs at least two reviewers.");
  }
  pushIf(errors, typeof dataset.provenance !== "string" || dataset.provenance.trim() === "",
    "provenance must be a non-empty string.");
  pushIf(errors, !Array.isArray(dataset.scenarios) || dataset.scenarios.length === 0,
    "scenarios must be a non-empty array.");

  const ids = new Set();
  const scenarios = Array.isArray(dataset.scenarios) ? dataset.scenarios : [];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const path = `scenarios[${scenarioIndex}]`;
    if (!isPlainObject(scenario)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    rejectUnexpectedKeys(errors, scenario, new Set([
      "id", "split", "category", "anchor", "context", "pins", "intent", "dialect",
      "expectedAnchorCoverage", "notes", "judgements",
    ]), path);
    pushIf(errors, typeof scenario.id !== "string" || scenario.id.trim() === "",
      `${path}.id must be a non-empty string.`);
    pushIf(errors, typeof scenario.id === "string" && !/^(dev|held)-[a-z0-9-]+$/.test(scenario.id),
      `${path}.id must use a dev- or held- lowercase slug.`);
    pushIf(errors,
      typeof scenario.id === "string" &&
      ((dataset.split === "development" && !scenario.id.startsWith("dev-")) ||
        (dataset.split === "held-out" && !scenario.id.startsWith("held-"))),
      `${path}.id prefix must match the dataset split.`);
    pushIf(errors, ids.has(scenario.id), `${path}.id duplicates ${scenario.id}.`);
    ids.add(scenario.id);
    pushIf(errors, scenario.split !== dataset.split, `${path}.split must match the dataset split.`);
    pushIf(errors, !CATEGORIES.has(scenario.category), `${path}.category is unsupported.`);
    pushIf(errors, typeof scenario.anchor !== "string" || scenario.anchor.trim() === "",
      `${path}.anchor must be a non-empty string.`);
    pushIf(errors, scenario.context !== null && typeof scenario.context !== "string",
      `${path}.context must be a string or null.`);
    pushIf(errors,
      scenario.intent === "bridge" &&
      (typeof scenario.context !== "string" || scenario.context.trim() === ""),
      `${path}.context must be non-empty for Bridge intent.`);
    pushIf(errors, !Array.isArray(scenario.pins), `${path}.pins must be an array.`);
    pushIf(errors, !INTENTS.has(scenario.intent), `${path}.intent is unsupported.`);
    pushIf(errors, typeof scenario.dialect !== "string" || scenario.dialect.trim() === "",
      `${path}.dialect must be a non-empty string.`);
    pushIf(errors, typeof scenario.expectedAnchorCoverage !== "boolean",
      `${path}.expectedAnchorCoverage must be boolean.`);
    pushIf(errors, !Array.isArray(scenario.judgements) || scenario.judgements.length < 3,
      `${path}.judgements must contain at least three candidates.`);

    const anchorTerms = new Set([normalizeText(String(scenario.anchor ?? ""))]);
    const pins = Array.isArray(scenario.pins) ? scenario.pins : [];
    for (const [pinIndex, pin] of pins.entries()) {
      const pinPath = `${path}.pins[${pinIndex}]`;
      pushIf(errors, typeof pin !== "string" || pin.trim() === "",
        `${pinPath} must be a non-empty string.`);
      const normalized = normalizeText(String(pin));
      pushIf(errors, anchorTerms.has(normalized), `${pinPath} duplicates an anchor or pin.`);
      anchorTerms.add(normalized);
    }

    const candidates = new Set();
    const judgements = Array.isArray(scenario.judgements) ? scenario.judgements : [];
    for (const [judgementIndex, judgement] of judgements.entries()) {
      const judgementPath = `${path}.judgements[${judgementIndex}]`;
      if (!isPlainObject(judgement)) {
        errors.push(`${judgementPath} must be an object.`);
        continue;
      }
      rejectUnexpectedKeys(errors, judgement,
        new Set(["candidate", "grade", "relationships", "rationale"]), judgementPath);
      pushIf(errors, typeof judgement.candidate !== "string" || judgement.candidate.trim() === "",
        `${judgementPath}.candidate must be a non-empty string.`);
      const candidate = normalizeText(String(judgement.candidate ?? ""));
      pushIf(errors, candidates.has(candidate), `${judgementPath}.candidate is duplicated.`);
      pushIf(errors, anchorTerms.has(candidate), `${judgementPath}.candidate repeats an anchor or pin.`);
      candidates.add(candidate);
      pushIf(errors, !GRADES.has(judgement.grade), `${judgementPath}.grade must be 0, 1, or 2.`);
      pushIf(errors, !Array.isArray(judgement.relationships),
        `${judgementPath}.relationships must be an array.`);
      const seenRelationships = new Set();
      const relationships = Array.isArray(judgement.relationships) ? judgement.relationships : [];
      for (const relationship of relationships) {
        pushIf(errors, !RELATIONSHIPS.has(relationship),
          `${judgementPath}.relationships contains unsupported value ${relationship}.`);
        pushIf(errors, seenRelationships.has(relationship),
          `${judgementPath}.relationships duplicates ${relationship}.`);
        seenRelationships.add(relationship);
      }
      pushIf(errors, typeof judgement.rationale !== "string" || judgement.rationale.trim() === "",
        `${judgementPath}.rationale must be a non-empty string.`);
    }
    pushIf(errors, judgements.length > 0 && !judgements.some((judgement) =>
      isPlainObject(judgement) && (judgement.grade === 1 || judgement.grade === 2)),
      `${path}.judgements must contain at least one relevant candidate.`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid evaluation dataset:\n- ${errors.join("\n- ")}`);
  }
  return dataset;
}

export async function readVersionedJson(url) {
  const contents = await readFile(url);
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { value, bytes: contents.byteLength, revision: digest(contents) };
}

export function utilityFromMetadata(word, senses) {
  const senseUtility = Math.min(.95, .35 + Math.log2(1 + Math.max(1, senses)) * .12);
  const lengthPenalty = Math.max(0, word.length - 13) * .012;
  return Math.max(.24, Math.min(.98, senseUtility - lengthPenalty));
}

export function tagsFromMask(mask) {
  const tags = [];
  if (mask & 1) tags.push("noun");
  if (mask & 2) tags.push("verb");
  if (mask & 4) tags.push("adjective");
  if (mask & 8) tags.push("adverb");
  return tags;
}

export function lexiconEntriesFromPack(pack) {
  if (!isPlainObject(pack) || typeof pack.version !== "string" || !Array.isArray(pack.entries) || !Array.isArray(pack.phrases)) {
    throw new Error("Compact lexicon is missing version, entries, or phrases.");
  }
  const entries = pack.entries.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 4) {
      throw new Error(`Compact lexicon entry ${index} is malformed.`);
    }
    const [text, pronunciations, partOfSpeechMask, senses] = entry;
    return {
      text,
      pronunciations,
      frequency: utilityFromMetadata(text, senses),
      tags: tagsFromMask(partOfSpeechMask),
    };
  });
  entries.push(...pack.phrases.map(([text, pronunciations]) => ({
    text,
    pronunciations,
    kind: "phrase",
    frequency: .58,
    tags: ["phrase"],
  })));
  return entries;
}

function lastStressedVowelIndex(pronunciation) {
  let fallback = -1;
  for (let index = pronunciation.phonemes.length - 1; index >= 0; index -= 1) {
    const phoneme = pronunciation.phonemes[index];
    if (phoneme.type !== "vowel") continue;
    if (fallback === -1) fallback = index;
    if (phoneme.stress === 1) return index;
  }
  return fallback;
}

function simplePairScore(left, right) {
  const leftStart = lastStressedVowelIndex(left);
  const rightStart = lastStressedVowelIndex(right);
  if (leftStart < 0 || rightStart < 0) return 0;
  const leftTail = left.phonemes.slice(leftStart);
  const rightTail = right.phonemes.slice(rightStart);
  const stressedVowelMatch = leftTail[0].symbol === rightTail[0].symbol ? 1 : 0;
  let sharedSuffix = 0;
  while (
    sharedSuffix < leftTail.length &&
    sharedSuffix < rightTail.length &&
    leftTail[leftTail.length - sharedSuffix - 1].symbol === rightTail[rightTail.length - sharedSuffix - 1].symbol
  ) {
    sharedSuffix += 1;
  }
  const suffixRatio = sharedSuffix / Math.max(leftTail.length, rightTail.length);
  return .6 * stressedVowelMatch + .4 * suffixRatio;
}

export function scoreSimpleBaseline(anchorItems, candidateItem) {
  if (anchorItems.some((item) => !item) || !candidateItem) return null;
  let winner = null;
  for (const candidatePronunciation of candidateItem.pronunciations) {
    const scores = anchorItems.map((anchor) => Math.max(
      ...anchor.pronunciations.map((anchorPronunciation) =>
        simplePairScore(anchorPronunciation, candidatePronunciation)),
    ));
    const mean = average(scores) ?? 0;
    const weakest = Math.min(...scores);
    const consistency = .68 * mean + .32 * weakest;
    const candidate = {
      score: round(consistency, 4),
      pronunciation: candidatePronunciation.source,
      anchorScores: scores.map((score) => round(score, 4)),
    };
    if (
      !winner ||
      candidate.score > winner.score ||
      (candidate.score === winner.score && lexicalCompare(candidate.pronunciation, winner.pronunciation) < 0)
    ) {
      winner = candidate;
    }
  }
  return winner;
}

function rankAvailable(judgements, scoredCandidates) {
  const byCandidate = new Map(scoredCandidates.map((item) => [normalizeText(item.candidate), item]));
  return judgements
    .map((judgement) => ({
      candidate: judgement.candidate,
      grade: judgement.grade,
      result: byCandidate.get(normalizeText(judgement.candidate)) ?? null,
    }))
    .filter((item) => item.result !== null && Number.isFinite(item.result.score))
    .sort((left, right) =>
      right.result.score - left.result.score || lexicalCompare(normalizeText(left.candidate), normalizeText(right.candidate)))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function dcg(grades, cutoff) {
  return grades.slice(0, cutoff).reduce(
    (total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

export function rankingMetrics(judgements, ranking) {
  const idealGrades = judgements.map((item) => item.grade).sort((left, right) => right - left);
  const rankedGrades = ranking.map((item) => item.grade);
  const ndcg = (cutoff) => {
    const ideal = dcg(idealGrades, cutoff);
    return ideal === 0 ? null : round(dcg(rankedGrades, cutoff) / ideal);
  };
  const firstKeepWorthy = ranking.findIndex((item) => item.grade === 2);
  const topThree = ranking.slice(0, 3);
  return {
    ndcgAt3: ndcg(3),
    ndcgAt10: ndcg(10),
    reciprocalRankKeepWorthy: firstKeepWorthy === -1 ? 0 : round(1 / (firstKeepWorthy + 1)),
    top3Unrelated: topThree.filter((item) => item.grade === 0).length,
    top3Returned: topThree.length,
    returned: ranking.length,
  };
}

function currentScenarioScores(scenario, entryMap) {
  const anchors = [scenario.anchor, ...scenario.pins];
  const relevantTerms = new Set([
    ...anchors,
    ...scenario.judgements.map((item) => item.candidate),
  ].map(normalizeText));
  const entries = [...relevantTerms].map((term) => entryMap.get(term)).filter(Boolean);
  const scenarioEngine = createRhymeEngine(entries);
  const anchorCovered = anchors.every((anchor) => Boolean(scenarioEngine.represent(anchor)));
  if (!anchorCovered) return { anchorCovered, candidates: [] };
  const recommendations = scenarioEngine.recommend({
    anchors,
    intent: scenario.intent,
    minPhonetic: 0,
    limit: scenario.judgements.length,
    weights: { sound: 1, meaning: 0, utility: 0 },
  });
  return {
    anchorCovered,
    candidates: recommendations.map((recommendation) => ({
      candidate: recommendation.item.normalized,
      score: recommendation.score,
      pronunciation: recommendation.pronunciation.source,
      phonetic: recommendation.family.phonetic,
      labels: recommendation.labels,
    })),
  };
}

function baselineScenarioScores(scenario, productionEngine) {
  const anchorItems = [scenario.anchor, ...scenario.pins].map((anchor) => productionEngine.represent(anchor));
  const anchorCovered = anchorItems.every(Boolean);
  if (!anchorCovered) return { anchorCovered, candidates: [] };
  return {
    anchorCovered,
    candidates: scenario.judgements.flatMap((judgement) => {
      const result = scoreSimpleBaseline(anchorItems, productionEngine.represent(judgement.candidate));
      return result ? [{ candidate: judgement.candidate, ...result }] : [];
    }),
  };
}

function modelScenarioResult(judgements, scoreResult) {
  const ranking = rankAvailable(judgements, scoreResult.candidates);
  return {
    anchorCovered: scoreResult.anchorCovered,
    candidateCoverage: scoreResult.candidates.length,
    metrics: rankingMetrics(judgements, ranking),
    ranking: ranking.map((item) => ({
      rank: item.rank,
      candidate: item.candidate,
      grade: item.grade,
      score: item.result.score,
      pronunciation: item.result.pronunciation,
      ...(item.result.phonetic === undefined ? {} : { phonetic: item.result.phonetic }),
      ...(item.result.labels === undefined ? {} : { labels: item.result.labels }),
      ...(item.result.anchorScores === undefined ? {} : { anchorScores: item.result.anchorScores }),
    })),
  };
}

function aggregateModel(scenarios, key) {
  const modelResults = scenarios.map((scenario) => scenario[key]);
  const coveredResults = modelResults.filter((result) => result.anchorCovered);
  const sum = (field) => modelResults.reduce((total, result) => total + result.metrics[field], 0);
  const candidateTotal = scenarios.reduce((total, scenario) => total + scenario.judgements.length, 0);
  const modelCandidateTotal = modelResults.reduce((total, result) => total + result.candidateCoverage, 0);
  const ndcgValues = (results, field) => results
    .map((result) => result.metrics[field])
    .filter((value) => value !== null);
  const falsePositiveSlots = sum("top3Returned");
  return {
    scenarios: modelResults.length,
    anchorCoverage: {
      covered: coveredResults.length,
      total: modelResults.length,
      rate: round(coveredResults.length / Math.max(1, modelResults.length)),
    },
    candidateCoverage: {
      covered: modelCandidateTotal,
      total: candidateTotal,
      rate: round(modelCandidateTotal / Math.max(1, candidateTotal)),
    },
    macroNdcgAt3: round(average(ndcgValues(modelResults, "ndcgAt3"))),
    macroNdcgAt10: round(average(ndcgValues(modelResults, "ndcgAt10"))),
    coveredMacroNdcgAt3: round(average(ndcgValues(coveredResults, "ndcgAt3"))),
    coveredMacroNdcgAt10: round(average(ndcgValues(coveredResults, "ndcgAt10"))),
    meanReciprocalRankKeepWorthy: round(average(modelResults.map((result) => result.metrics.reciprocalRankKeepWorthy))),
    highImpactFalsePositiveRate: falsePositiveSlots === 0
      ? null
      : round(sum("top3Unrelated") / falsePositiveSlots),
    highImpactFalsePositiveSlots: sum("top3Unrelated"),
    labelledTop3Slots: falsePositiveSlots,
  };
}

function comparisonSummary(baseline, current) {
  const delta = (field) => baseline[field] === null || current[field] === null
    ? null
    : round(current[field] - baseline[field]);
  return {
    macroNdcgAt3: delta("macroNdcgAt3"),
    macroNdcgAt10: delta("macroNdcgAt10"),
    coveredMacroNdcgAt3: delta("coveredMacroNdcgAt3"),
    coveredMacroNdcgAt10: delta("coveredMacroNdcgAt10"),
    meanReciprocalRankKeepWorthy: delta("meanReciprocalRankKeepWorthy"),
    highImpactFalsePositiveRate: delta("highImpactFalsePositiveRate"),
  };
}

function countDistribution(values) {
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : lexicalCompare(left, right);
  }));
}

export async function loadEvaluationInputs({
  scenarioUrl = DEFAULT_SCENARIO_URL,
  lexiconUrl = DEFAULT_LEXICON_URL,
} = {}) {
  const [scenarioFile, lexiconFile, engineSource, evaluatorSource] = await Promise.all([
    readVersionedJson(scenarioUrl),
    readVersionedJson(lexiconUrl),
    readFile(ENGINE_SOURCE_URL),
    readFile(EVALUATOR_SOURCE_URL),
  ]);
  const dataset = validateDataset(scenarioFile.value);
  const lexiconEntries = lexiconEntriesFromPack(lexiconFile.value);
  return {
    dataset,
    pack: lexiconFile.value,
    lexiconEntries,
    revisions: {
      scenarios: scenarioFile.revision,
      lexicon: lexiconFile.revision,
      engine: digest(engineSource),
      evaluator: digest(evaluatorSource),
    },
    bytes: {
      scenarios: scenarioFile.bytes,
      lexicon: lexiconFile.bytes,
    },
  };
}

export function assertCoverageExpectations(dataset, productionEngine) {
  const mismatches = [];
  for (const scenario of dataset.scenarios) {
    const actual = [scenario.anchor, ...scenario.pins].every((anchor) =>
      Boolean(productionEngine.represent(anchor)));
    if (actual !== scenario.expectedAnchorCoverage) {
      mismatches.push(
        `${scenario.id}: expectedAnchorCoverage=${scenario.expectedAnchorCoverage}, actual=${actual}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Evaluation coverage expectations changed:\n- ${mismatches.join("\n- ")}`);
  }
}

export async function evaluateDataset({
  scenarioUrl = DEFAULT_SCENARIO_URL,
  lexiconUrl = DEFAULT_LEXICON_URL,
  generatedAt = new Date().toISOString(),
} = {}) {
  const inputs = await loadEvaluationInputs({ scenarioUrl, lexiconUrl });
  const productionEngine = createRhymeEngine(inputs.lexiconEntries);
  assertCoverageExpectations(inputs.dataset, productionEngine);
  const entryMap = new Map(inputs.lexiconEntries.map((entry) => [normalizeText(entry.text), entry]));

  const scenarios = inputs.dataset.scenarios.map((scenario) => {
    const baseline = modelScenarioResult(
      scenario.judgements,
      baselineScenarioScores(scenario, productionEngine),
    );
    const current = modelScenarioResult(
      scenario.judgements,
      currentScenarioScores(scenario, entryMap),
    );
    return {
      id: scenario.id,
      split: scenario.split,
      category: scenario.category,
      anchor: scenario.anchor,
      pins: scenario.pins,
      intent: scenario.intent,
      dialect: scenario.dialect,
      expectedAnchorCoverage: scenario.expectedAnchorCoverage,
      judgements: scenario.judgements,
      [BASELINE_ID]: baseline,
      [CURRENT_ENGINE_ID]: current,
    };
  });

  const baseline = aggregateModel(scenarios, BASELINE_ID);
  const current = aggregateModel(scenarios, CURRENT_ENGINE_ID);
  return {
    schemaVersion: EVALUATION_REPORT_VERSION,
    generatedAt,
    dataset: {
      id: inputs.dataset.datasetId,
      version: inputs.dataset.datasetVersion,
      schemaVersion: inputs.dataset.schemaVersion,
      revision: inputs.revisions.scenarios,
      split: inputs.dataset.split,
      heldOut: inputs.dataset.heldOut,
      judgement: inputs.dataset.judgement,
      provenance: inputs.dataset.provenance,
      scenarioCount: inputs.dataset.scenarios.length,
      intentDistribution: countDistribution(inputs.dataset.scenarios.map((scenario) => scenario.intent)),
      pinCountDistribution: countDistribution(inputs.dataset.scenarios.map((scenario) => scenario.pins.length)),
      maximumAnchorCount: Math.max(
        ...inputs.dataset.scenarios.map((scenario) => 1 + scenario.pins.length),
      ),
    },
    lexicon: {
      version: inputs.pack.version,
      dialect: inputs.pack.dialect,
      revision: inputs.revisions.lexicon,
      wordsAndPhrases: inputs.lexiconEntries.length,
    },
    engine: {
      id: CURRENT_ENGINE_ID,
      sourceRevision: inputs.revisions.engine,
    },
    evaluator: {
      sourceRevision: inputs.revisions.evaluator,
    },
    protocol: {
      scope: "machine-assisted-development-candidate-pool-reranking",
      labelSource: "Machine-assisted development fixtures with zero human reviewers. Labels are provisional test inputs, not human judgement evidence.",
      gradeGain: "2^grade-1",
      tieBreak: "normalized-candidate-lexical-order",
      baseline: "0.6 exact stressed-vowel identity + 0.4 shared ARPAbet suffix ratio; multi-pin scores use 0.68 mean + 0.32 weakest; intent-agnostic",
      currentEngine: "recommend() over the machine-assisted labelled development pool with minPhonetic=0 and weights sound=1, meaning=0, utility=0",
      semanticScope: "Bridge grades may use authored context, but both compared scorers are phonetic-only and receive no semantic scores. This report does not measure Bridge semantic quality.",
      caveat: "Unreviewed machine-assisted development data only. These metrics do not measure human judgement, full-corpus retrieval, or unbiased product quality.",
    },
    summary: {
      [BASELINE_ID]: baseline,
      [CURRENT_ENGINE_ID]: current,
      currentMinusBaseline: comparisonSummary(baseline, current),
    },
    scenarios,
  };
}
