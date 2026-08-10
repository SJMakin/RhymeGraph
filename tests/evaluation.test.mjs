import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASELINE_ID,
  CURRENT_ENGINE_ID,
  DEFAULT_SCENARIO_URL,
  evaluateDataset,
  loadEvaluationInputs,
  scoreSimpleBaseline,
  validateDataset,
} from "../evaluation/core.mjs";
import {
  benchmarkQuality,
  describeBenchmarkSelection,
  parseBenchmarkArguments,
  runSoundBenchmark,
  selectBenchmarkQueries,
  summarizeSamples,
} from "../scripts/benchmark-sound.mjs";
import { parseEvaluateArguments } from "../scripts/evaluate.mjs";
import { createRhymeEngine } from "../lib/phonetics/engine.ts";

test("the v1 evidence set is explicitly provisional development data with 25 scenarios", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../evaluation/scenario-schema.v1.json", import.meta.url),
    "utf8",
  ));
  const inputs = await loadEvaluationInputs();
  const dataset = validateDataset(inputs.dataset);

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.schemaVersion.const, dataset.schemaVersion);
  assert.equal(schema.properties.judgement.properties.reviewerCount.minimum, 0);
  assert.equal(dataset.scenarios.length, 25);
  assert.equal(dataset.datasetVersion, "1.1.0");
  assert.equal(dataset.split, "development");
  assert.equal(dataset.heldOut, false);
  assert.equal(dataset.judgement.status, "provisional-development");
  assert.equal(dataset.judgement.reviewerCount, 0);
  assert.equal(dataset.judgement.reviewType, "unreviewed-machine-assisted");
  assert.match(dataset.provenance, /zero human reviewers/i);
  assert.ok(dataset.scenarios.every((scenario) => scenario.split === "development"));
  assert.ok(dataset.scenarios.every((scenario) => scenario.id.startsWith("dev-")));
  assert.ok(dataset.scenarios.some((scenario) => scenario.category === "mosaic"));
  assert.ok(dataset.scenarios.some((scenario) => scenario.category === "multi-pin"));
  assert.ok(dataset.scenarios.some((scenario) => scenario.category === "unknown-word"));
  assert.deepEqual(
    Object.fromEntries([...new Set(dataset.scenarios.map((scenario) => scenario.intent))]
      .sort().map((intent) => [intent, dataset.scenarios.filter((scenario) => scenario.intent === intent).length])),
    { bridge: 2, continue: 21, pivot: 2 },
  );
  assert.deepEqual(
    Object.fromEntries([0, 1, 2, 4].map((pinCount) => [
      pinCount,
      dataset.scenarios.filter((scenario) => scenario.pins.length === pinCount).length,
    ])),
    { 0: 22, 1: 1, 2: 1, 4: 1 },
  );
  assert.ok(dataset.scenarios.filter((scenario) => scenario.intent === "bridge")
    .every((scenario) => scenario.context && scenario.notes));
  assert.equal(Math.max(...dataset.scenarios.map((scenario) => scenario.pins.length)), 4);
  assert.match(inputs.revisions.scenarios, /^sha256:[a-f0-9]{64}$/);
  assert.match(inputs.revisions.evaluator, /^sha256:[a-f0-9]{64}$/);
});

test("schema validation rejects leakage-prone split metadata and duplicate candidates", async () => {
  const inputs = await loadEvaluationInputs();
  const heldOutLie = structuredClone(inputs.dataset);
  heldOutLie.heldOut = true;
  assert.throws(() => validateDataset(heldOutLie), /heldOut must be true exactly/i);

  const duplicate = structuredClone(inputs.dataset);
  duplicate.scenarios[0].judgements[1].candidate = duplicate.scenarios[0].judgements[0].candidate;
  assert.throws(() => validateDataset(duplicate), /candidate is duplicated/i);

  const contextlessBridge = structuredClone(inputs.dataset);
  contextlessBridge.scenarios.find((scenario) => scenario.intent === "bridge").context = null;
  assert.throws(() => validateDataset(contextlessBridge), /context must be non-empty for Bridge/i);

  const inventedReviewer = structuredClone(inputs.dataset);
  inventedReviewer.judgement.reviewerCount = 1;
  assert.throws(() => validateDataset(inventedReviewer), /zero human reviewers/i);

  const unreviewedFrozen = structuredClone(inputs.dataset);
  unreviewedFrozen.split = "held-out";
  unreviewedFrozen.heldOut = true;
  unreviewedFrozen.judgement.status = "double-reviewed-frozen";
  unreviewedFrozen.scenarios.forEach((scenario) => {
    scenario.id = scenario.id.replace(/^dev-/, "held-");
    scenario.split = "held-out";
  });
  assert.throws(() => validateDataset(unreviewedFrozen), /at least two reviewers/i);
});

test("the stressed-vowel/suffix baseline is deterministic and deliberately simple", () => {
  const engine = createRhymeEngine([
    { text: "time", pronunciations: ["T AY1 M"] },
    { text: "rhyme", pronunciations: ["R AY1 M"] },
    { text: "mine", pronunciations: ["M AY1 N"] },
    { text: "dog", pronunciations: ["D AO1 G"] },
  ]);
  const anchor = engine.represent("time");
  const exact = scoreSimpleBaseline([anchor], engine.represent("rhyme"));
  const assonant = scoreSimpleBaseline([anchor], engine.represent("mine"));
  const unrelated = scoreSimpleBaseline([anchor], engine.represent("dog"));

  assert.deepEqual(
    scoreSimpleBaseline([anchor], engine.represent("rhyme")),
    exact,
  );
  assert.ok(exact.score > assonant.score);
  assert.ok(assonant.score > unrelated.score);
  assert.equal(scoreSimpleBaseline([undefined], engine.represent("rhyme")), null);
});

test("evaluation is deterministic apart from an injected timestamp and reports both revisions", async () => {
  const generatedAt = "2026-08-10T00:00:00.000Z";
  const first = await evaluateDataset({ generatedAt });
  const second = await evaluateDataset({ generatedAt });
  const inputs = await loadEvaluationInputs();
  assert.deepEqual(second, first);

  assert.equal(first.dataset.scenarioCount, 25);
  assert.equal(first.dataset.revision, inputs.revisions.scenarios);
  assert.equal(first.dataset.heldOut, false);
  assert.equal(first.dataset.judgement.reviewerCount, 0);
  assert.equal(first.dataset.judgement.reviewType, "unreviewed-machine-assisted");
  assert.match(first.dataset.provenance, /zero human reviewers/i);
  assert.deepEqual(first.dataset.intentDistribution, { bridge: 2, continue: 21, pivot: 2 });
  assert.deepEqual(first.dataset.pinCountDistribution, { 0: 22, 1: 1, 2: 1, 4: 1 });
  assert.equal(first.dataset.maximumAnchorCount, 5);
  assert.match(first.dataset.revision, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.lexicon.revision, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.engine.sourceRevision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.evaluator.sourceRevision, inputs.revisions.evaluator);
  assert.match(first.evaluator.sourceRevision, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(first.summary[BASELINE_ID].macroNdcgAt3));
  assert.ok(Number.isFinite(first.summary[CURRENT_ENGINE_ID].macroNdcgAt3));
  assert.equal(first.summary[CURRENT_ENGINE_ID].labelledTop3Slots, 72);
  assert.equal("reviewedTop3Slots" in first.summary[CURRENT_ENGINE_ID], false);
  assert.match(first.protocol.semanticScope, /does not measure Bridge semantic quality/i);
  assert.match(first.protocol.labelSource, /zero human reviewers/i);
  assert.match(first.protocol.caveat, /do(?:es)? not measure human judgement/i);

  const unknown = first.scenarios.find((scenario) => scenario.id === "dev-unknown-skrrt");
  assert.ok(unknown);
  assert.equal(unknown[BASELINE_ID].anchorCovered, false);
  assert.equal(unknown[CURRENT_ENGINE_ID].anchorCovered, false);
  assert.equal(unknown[CURRENT_ENGINE_ID].metrics.ndcgAt3, 0);
});

test("command parsers default to ignored reports and reject ambiguous output", () => {
  const evaluate = parseEvaluateArguments([]);
  const benchmark = parseBenchmarkArguments([]);
  assert.match(evaluate.outputPath.replaceAll("\\", "/"), /\/outputs\/evaluation-report\.json$/);
  assert.match(benchmark.outputPath.replaceAll("\\", "/"), /\/outputs\/sound-benchmark\.json$/);
  assert.throws(
    () => parseEvaluateArguments(["--stdout", "--out", "outputs/other.json"]),
    /mutually exclusive/i,
  );
  assert.throws(() => parseBenchmarkArguments(["--iterations", "0"]), /positive integer/i);
  assert.equal(parseEvaluateArguments(["--dataset", "evaluation/scenarios.v1.json"]).scenarioUrl.href,
    DEFAULT_SCENARIO_URL.href);
});

test("benchmark statistics and query selection are stable", async () => {
  assert.deepEqual(summarizeSamples([4, 1, 3, 2]), {
    samples: 4,
    minMs: 1,
    meanMs: 2.5,
    observedP50Ms: 2,
    observedP95Ms: 4,
    maxMs: 4,
  });
  const { dataset } = await loadEvaluationInputs();
  const queries = selectBenchmarkQueries(dataset, 6);
  const reversed = selectBenchmarkQueries({
    ...dataset,
    scenarios: [...dataset.scenarios].reverse(),
  }, 6);
  const selection = describeBenchmarkSelection(dataset, queries);
  assert.equal(queries.length, 6);
  assert.deepEqual(reversed.map((query) => query.id), queries.map((query) => query.id));
  assert.ok(new Set(queries.map((query) => query.category)).size >= 4);
  assert.ok(queries.every((query) => query.expectedAnchorCoverage));
  assert.equal(selection.includesMaximumPinWorkload, true);
  assert.equal(selection.maximumSelectedPinCount, selection.maximumAvailablePinCount);
  assert.equal(selection.coversAllAvailableIntents, true);
  assert.equal(selection.coversAllAvailablePinCounts, true);
  assert.deepEqual(selection.selectedIntents, ["bridge", "continue", "pivot"]);
  assert.deepEqual(selection.selectedPinCounts, [0, 1, 2, 4]);
  assert.equal(selection.maximumSelectedPinCount, 4);
});

test("benchmark selection prioritizes every intent and the maximum pin count", () => {
  const scenario = (id, intent, pins, category) => ({
    id,
    intent,
    pins,
    category,
    expectedAnchorCoverage: true,
  });
  const dataset = {
    scenarios: [
      scenario("dev-z-flat", "continue", [], "full-rhyme"),
      scenario("dev-c-one-pin", "continue", ["one"], "multi-pin"),
      scenario("dev-d-three-pins", "continue", ["one", "two", "three"], "multi-pin"),
      scenario("dev-b-bridge", "bridge", [], "mosaic"),
      scenario("dev-a-pivot", "pivot", [], "pivot"),
      scenario("dev-e-extra", "continue", [], "assonance"),
    ],
  };
  const selected = selectBenchmarkQueries(dataset, 4);
  const selection = describeBenchmarkSelection(dataset, selected);

  assert.deepEqual(selection.selectedIntents, ["bridge", "continue", "pivot"]);
  assert.deepEqual(selection.selectedPinCounts, [0, 1, 3]);
  assert.equal(selection.maximumSelectedPinCount, 3);
  assert.equal(selection.includesMaximumPinWorkload, true);
  assert.equal(selection.coversAllAvailableIntents, true);
  assert.equal(selection.coversAllAvailablePinCounts, true);
});

test("benchmark quality never presents a quick run as a robust p95", () => {
  const completeSelection = {
    coversAllAvailableIntents: true,
    coversAllAvailablePinCounts: true,
    includesMaximumPinWorkload: true,
  };
  const diagnostic = benchmarkQuality(29, {
    device: "reference-desktop",
    powerProfile: "AC balanced",
    warmup: 3,
    selection: completeSelection,
  });
  assert.equal(diagnostic.status, "diagnostic");
  assert.equal(diagnostic.referenceEligible, false);
  assert.equal(diagnostic.minimumPassThresholdMet, false);
  assert.equal(diagnostic.timedPassShortfall, 1);
  assert.match(diagnostic.percentileInterpretation, /not be presented as a robust p95/i);

  const candidate = benchmarkQuality(30, {
    device: "reference-desktop",
    powerProfile: "AC balanced",
    warmup: 3,
    selection: completeSelection,
  });
  assert.equal(candidate.status, "reference-candidate");
  assert.equal(candidate.referenceEligible, true);
  assert.equal(candidate.minimumPassThresholdMet, true);
  assert.equal(candidate.timedPassShortfall, 0);

  const incompleteManifest = benchmarkQuality(30, {
    warmup: 3,
    selection: completeSelection,
  });
  assert.equal(incompleteManifest.status, "reference-candidate");
  assert.equal(incompleteManifest.referenceEligible, false);
  assert.equal(incompleteManifest.manifestAnnotationsComplete, false);

  const insufficientWarmup = benchmarkQuality(30, {
    device: "reference-desktop",
    powerProfile: "AC balanced",
    warmup: 0,
    selection: completeSelection,
  });
  assert.equal(insufficientWarmup.referenceEligible, false);
  assert.equal(insufficientWarmup.minimumWarmupThresholdMet, false);
  assert.equal(insufficientWarmup.warmupPassShortfall, 3);
  assert.match(insufficientWarmup.ineligibilityReasons.join(" "), /warm-up passes/i);

  const incompleteSelection = benchmarkQuality(30, {
    device: "reference-desktop",
    powerProfile: "AC balanced",
    warmup: 3,
    selection: {
      coversAllAvailableIntents: false,
      coversAllAvailablePinCounts: false,
      includesMaximumPinWorkload: true,
    },
  });
  assert.equal(incompleteSelection.referenceEligible, false);
  assert.equal(incompleteSelection.selectionCoverageComplete, false);
  assert.match(incompleteSelection.ineligibilityReasons.join(" "), /intent/i);
  assert.match(incompleteSelection.ineligibilityReasons.join(" "), /pin count/i);
});

test("a minimal sound benchmark records runtime, device, and both dataset revisions", async () => {
  const options = parseBenchmarkArguments([
    "--iterations", "1",
    "--warmup", "0",
    "--queries", "1",
    "--device", "test-device",
    "--power-profile", "test-profile",
  ]);
  const report = await runSoundBenchmark(options);

  assert.equal(report.configuration.timedPasses, 1);
  assert.equal(report.configuration.queryCount, 1);
  assert.equal(report.configuration.selection.includesMaximumPinWorkload, true);
  assert.equal(report.device.label, "test-device");
  assert.equal(report.device.powerProfile, "test-profile");
  assert.equal(report.quality.status, "diagnostic");
  assert.equal(report.quality.referenceEligible, false);
  assert.equal(report.quality.selectionCoverageComplete, false);
  assert.match(report.quality.ineligibilityReasons.join(" "), /intent/i);
  assert.match(report.quality.ineligibilityReasons.join(" "), /pin count/i);
  assert.match(report.quality.percentileInterpretation, /diagnostic only/i);
  assert.match(report.dataset.scenarioRevision, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.dataset.lexiconRevision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.workloads.exhaustiveRecommendationPass.summary.samples, 1);
  assert.ok(report.workloads.exhaustiveRecommendationQuery.summary.observedP95Ms > 0);
  assert.equal("p95Ms" in report.workloads.exhaustiveRecommendationQuery.summary, false);
  assert.match(report.caveats[0], /Diagnostic only/i);
  assert.ok(Number.isFinite(report.checksum));
});
