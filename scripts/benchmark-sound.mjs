import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_LEXICON_URL,
  DEFAULT_SCENARIO_URL,
  ENGINE_SOURCE_URL,
  assertCoverageExpectations,
  lexiconEntriesFromPack,
  validateDataset,
} from "../evaluation/core.mjs";
import { createRhymeEngine } from "../lib/phonetics/engine.ts";

export const SOUND_BENCHMARK_REPORT_VERSION = "rhymegraph.sound-benchmark.v1";

const DEFAULT_OUTPUT = resolve("outputs/sound-benchmark.json");
const DEFAULT_ITERATIONS = 5;
const DEFAULT_WARMUP = 2;
const DEFAULT_QUERY_COUNT = 6;
const REFERENCE_MINIMUM_TIMED_PASSES = 30;
const REFERENCE_MINIMUM_WARMUP_PASSES = 3;
const QUERY_SELECTION_STRATEGY = "deterministic-stratified-greedy-v1";

function usage() {
  return `Usage: node --experimental-strip-types scripts/benchmark-sound.mjs [options]

Options:
  --dataset PATH          Scenario dataset (default: evaluation/scenarios.v1.json)
  --lexicon PATH          Compact lexicon (default: public/data/cmudict.compact.json)
  --out PATH              Report path (default: outputs/sound-benchmark.json)
  --stdout                Write JSON to stdout instead of a file
  --iterations N          Timed query-set passes (default: ${DEFAULT_ITERATIONS})
  --warmup N              Untimed query-set passes (default: ${DEFAULT_WARMUP})
  --queries N             Distinct scenario queries per pass (default: ${DEFAULT_QUERY_COUNT})
  --device LABEL          Stable local device label
  --power-profile LABEL   Power/thermal profile annotation
  --pretty                Indent JSON output
  --check                 Validate inputs and query coverage; run no timings
  --help                  Show this help`;
}

function positiveInteger(raw, option, { allowZero = false } = {}) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${option} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return value;
}

export function parseBenchmarkArguments(argv) {
  const options = {
    scenarioUrl: DEFAULT_SCENARIO_URL,
    lexiconUrl: DEFAULT_LEXICON_URL,
    outputPath: DEFAULT_OUTPUT,
    stdout: false,
    iterations: DEFAULT_ITERATIONS,
    warmup: DEFAULT_WARMUP,
    queryCount: DEFAULT_QUERY_COUNT,
    device: process.env.RHYMEGRAPH_DEVICE_NAME || "unlabelled-local-machine",
    powerProfile: process.env.RHYMEGRAPH_POWER_PROFILE || "unrecorded",
    pretty: false,
    check: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pretty") options.pretty = true;
    else if (argument === "--stdout") options.stdout = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if ([
      "--dataset", "--lexicon", "--out", "--iterations", "--warmup", "--queries",
      "--device", "--power-profile",
    ].includes(argument)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--dataset") options.scenarioUrl = pathToFileURL(resolve(value));
      else if (argument === "--lexicon") options.lexiconUrl = pathToFileURL(resolve(value));
      else if (argument === "--out") options.outputPath = resolve(value);
      else if (argument === "--iterations") options.iterations = positiveInteger(value, argument);
      else if (argument === "--warmup") options.warmup = positiveInteger(value, argument, { allowZero: true });
      else if (argument === "--queries") options.queryCount = positiveInteger(value, argument);
      else if (argument === "--device") options.device = value.trim();
      else options.powerProfile = value.trim();
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.device) throw new Error("--device must not be empty.");
  if (!options.powerProfile) throw new Error("--power-profile must not be empty.");
  if (options.stdout && options.outputPath !== DEFAULT_OUTPUT) {
    throw new Error("--stdout and --out are mutually exclusive.");
  }
  return options;
}

function revision(contents) {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function memoryMiB() {
  const memory = process.memoryUsage();
  return Object.fromEntries(
    Object.entries(memory).map(([key, value]) => [key, round(value / 1024 / 1024)]),
  );
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((value) => !Number.isFinite(value))) {
    throw new Error("Benchmark samples must be a non-empty array of finite numbers.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    samples: samples.length,
    minMs: round(sorted[0]),
    meanMs: round(samples.reduce((total, value) => total + value, 0) / samples.length),
    observedP50Ms: round(percentile(.5)),
    observedP95Ms: round(percentile(.95)),
    maxMs: round(sorted.at(-1)),
  };
}

export function selectBenchmarkQueries(dataset, count) {
  const covered = dataset.scenarios
    .filter((scenario) => scenario.expectedAnchorCoverage)
    .sort((left, right) => lexicalCompare(left.id, right.id));
  if (count > covered.length) {
    throw new Error(`Requested ${count} benchmark queries, but only ${covered.length} covered scenarios exist.`);
  }
  if (covered.length === 0) return [];

  const maximumPinCount = Math.max(...covered.map((scenario) => scenario.pins.length));
  const selected = [];
  const intents = new Set();
  const pinCounts = new Set();
  const categories = new Set();

  while (selected.length < count) {
    const includesMaximumPins = selected.some((scenario) => scenario.pins.length === maximumPinCount);
    const remaining = covered.filter((scenario) => !selected.includes(scenario));
    remaining.sort((left, right) => {
      const score = (scenario) =>
        (!includesMaximumPins && scenario.pins.length === maximumPinCount ? 1_000_000 : 0) +
        (!intents.has(scenario.intent) ? 10_000 : 0) +
        (!pinCounts.has(scenario.pins.length) ? 1_000 : 0) +
        (!categories.has(scenario.category) ? 100 : 0) +
        scenario.pins.length;
      return score(right) - score(left) || lexicalCompare(left.id, right.id);
    });
    const winner = remaining[0];
    selected.push(winner);
    intents.add(winner.intent);
    pinCounts.add(winner.pins.length);
    categories.add(winner.category);
  }
  return selected;
}

export function describeBenchmarkSelection(dataset, queries) {
  const available = dataset.scenarios.filter((scenario) => scenario.expectedAnchorCoverage);
  const values = (items) => [...items].sort((left, right) =>
    typeof left === "number" ? left - right : lexicalCompare(left, right));
  const availableIntents = values(new Set(available.map((scenario) => scenario.intent)));
  const selectedIntents = values(new Set(queries.map((scenario) => scenario.intent)));
  const availablePinCounts = values(new Set(available.map((scenario) => scenario.pins.length)));
  const selectedPinCounts = values(new Set(queries.map((scenario) => scenario.pins.length)));
  const maximumAvailablePinCount = Math.max(0, ...availablePinCounts);
  const maximumSelectedPinCount = Math.max(0, ...selectedPinCounts);
  return {
    strategy: QUERY_SELECTION_STRATEGY,
    deterministicTieBreak: "scenario-id-lexical-order",
    availableIntents,
    selectedIntents,
    coversAllAvailableIntents: availableIntents.every((intent) => selectedIntents.includes(intent)),
    availablePinCounts,
    selectedPinCounts,
    coversAllAvailablePinCounts: availablePinCounts.every((pinCount) => selectedPinCounts.includes(pinCount)),
    maximumAvailablePinCount,
    maximumSelectedPinCount,
    hasPinnedWorkloadAvailable: maximumAvailablePinCount > 0,
    includesMaximumPinWorkload: maximumSelectedPinCount === maximumAvailablePinCount,
    selectedCategoryCount: new Set(queries.map((scenario) => scenario.category)).size,
  };
}

export function benchmarkQuality(timedPasses, {
  device = "unlabelled-local-machine",
  powerProfile = "unrecorded",
  warmup = 0,
  selection,
} = {}) {
  const meetsPassThreshold = timedPasses >= REFERENCE_MINIMUM_TIMED_PASSES;
  const meetsWarmupThreshold = warmup >= REFERENCE_MINIMUM_WARMUP_PASSES;
  const manifestAnnotationsComplete =
    device !== "unlabelled-local-machine" && powerProfile !== "unrecorded";
  const selectionCoverage = {
    coversAllAvailableIntents: selection?.coversAllAvailableIntents === true,
    coversAllAvailablePinCounts: selection?.coversAllAvailablePinCounts === true,
    includesMaximumPinWorkload: selection?.includesMaximumPinWorkload === true,
  };
  const selectionCoverageComplete = Object.values(selectionCoverage).every(Boolean);
  const ineligibilityReasons = [
    ...(!meetsPassThreshold
      ? [`Needs at least ${REFERENCE_MINIMUM_TIMED_PASSES} timed passes (received ${timedPasses}).`]
      : []),
    ...(!meetsWarmupThreshold
      ? [`Needs at least ${REFERENCE_MINIMUM_WARMUP_PASSES} warm-up passes (received ${warmup}).`]
      : []),
    ...(!manifestAnnotationsComplete
      ? ["Device and power-profile labels must both be explicit and non-placeholder."]
      : []),
    ...(!selectionCoverage.coversAllAvailableIntents
      ? ["Query selection does not cover every available intent."]
      : []),
    ...(!selectionCoverage.coversAllAvailablePinCounts
      ? ["Query selection does not cover every available pin count."]
      : []),
    ...(!selectionCoverage.includesMaximumPinWorkload
      ? ["Query selection does not include the maximum-pin workload."]
      : []),
  ];
  return {
    status: meetsPassThreshold ? "reference-candidate" : "diagnostic",
    referenceEligible:
      meetsPassThreshold && meetsWarmupThreshold && manifestAnnotationsComplete && selectionCoverageComplete,
    minimumPassThresholdMet: meetsPassThreshold,
    minimumWarmupThresholdMet: meetsWarmupThreshold,
    manifestAnnotationsComplete,
    selectionCoverageComplete,
    selectionCoverage,
    timedPasses,
    minimumTimedPassesForReference: REFERENCE_MINIMUM_TIMED_PASSES,
    timedPassShortfall: Math.max(0, REFERENCE_MINIMUM_TIMED_PASSES - timedPasses),
    warmupPasses: warmup,
    minimumWarmupPassesForReference: REFERENCE_MINIMUM_WARMUP_PASSES,
    warmupPassShortfall: Math.max(0, REFERENCE_MINIMUM_WARMUP_PASSES - warmup),
    ineligibilityReasons,
    percentileInterpretation: meetsPassThreshold
      ? "Minimum timed-pass threshold met; reference eligibility also requires three warm-ups, complete query coverage, explicit device/power labels, and controlled matching conditions."
      : "Insufficient passes for a robust tail estimate; observedP95Ms is diagnostic only and must not be presented as a robust p95.",
  };
}

function timed(operation) {
  const started = performance.now();
  const value = operation();
  return { value, elapsedMs: performance.now() - started };
}

async function loadBenchmarkInputs(options) {
  const readStarted = performance.now();
  const [lexiconContents, scenarioContents, engineSource] = await Promise.all([
    readFile(options.lexiconUrl),
    readFile(options.scenarioUrl),
    readFile(ENGINE_SOURCE_URL),
  ]);
  const readElapsedMs = performance.now() - readStarted;
  const lexiconParse = timed(() => JSON.parse(lexiconContents.toString("utf8")));
  const scenarioParse = timed(() => validateDataset(JSON.parse(scenarioContents.toString("utf8"))));
  const conversion = timed(() => lexiconEntriesFromPack(lexiconParse.value));
  const indexing = timed(() => createRhymeEngine(conversion.value));
  const queries = selectBenchmarkQueries(scenarioParse.value, options.queryCount);
  const selection = describeBenchmarkSelection(scenarioParse.value, queries);
  if (!selection.includesMaximumPinWorkload) {
    throw new Error("Benchmark query selection omitted the maximum-pin workload.");
  }
  if (
    options.queryCount >= selection.availableIntents.length &&
    !selection.coversAllAvailableIntents
  ) {
    throw new Error("Benchmark query selection failed to cover available intents.");
  }
  if (
    options.queryCount >= selection.availablePinCounts.length &&
    !selection.coversAllAvailablePinCounts
  ) {
    throw new Error("Benchmark query selection failed to cover available pin counts.");
  }
  assertCoverageExpectations(scenarioParse.value, indexing.value);
  for (const query of queries) {
    if (![query.anchor, ...query.pins].every((anchor) => indexing.value.represent(anchor))) {
      throw new Error(`Benchmark query ${query.id} contains an unavailable anchor.`);
    }
  }
  return {
    dataset: scenarioParse.value,
    pack: lexiconParse.value,
    engine: indexing.value,
    queries,
    selection,
    revisions: {
      scenarios: revision(scenarioContents),
      lexicon: revision(lexiconContents),
      engine: revision(engineSource),
    },
    bytes: {
      scenarios: scenarioContents.byteLength,
      lexicon: lexiconContents.byteLength,
    },
    initialization: {
      parallelFileReadMs: round(readElapsedMs),
      lexiconParseMs: round(lexiconParse.elapsedMs),
      scenarioParseAndValidationMs: round(scenarioParse.elapsedMs),
      lexiconConversionMs: round(conversion.elapsedMs),
      engineIndexMs: round(indexing.elapsedMs),
    },
  };
}

function runPairComparisonPass(engine, queries) {
  let operations = 0;
  let checksum = 0;
  const started = performance.now();
  for (const query of queries) {
    for (const judgement of query.judgements) {
      const result = engine.compare(query.anchor, judgement.candidate);
      if (result) checksum += result.components.phonetic;
      operations += 1;
    }
  }
  return { elapsedMs: performance.now() - started, operations, checksum };
}

function runExhaustivePass(engine, queries) {
  const perQuery = [];
  let checksum = 0;
  const passStarted = performance.now();
  for (const query of queries) {
    const started = performance.now();
    const results = engine.recommend({
      anchors: [query.anchor, ...query.pins],
      intent: query.intent,
      minPhonetic: 0,
      limit: 25,
      weights: { sound: 1, meaning: 0, utility: 0 },
    });
    const elapsedMs = performance.now() - started;
    checksum += results.reduce((total, result) => total + result.score, 0);
    perQuery.push({ id: query.id, elapsedMs });
  }
  return { elapsedMs: performance.now() - passStarted, perQuery, checksum };
}

function cpuManifest() {
  const processors = cpus();
  const first = processors[0];
  return {
    model: first?.model?.trim() || "unknown",
    logicalCores: processors.length,
    reportedSpeedMHz: first?.speed ?? null,
  };
}

export async function runSoundBenchmark(options) {
  const memoryBeforeLoad = memoryMiB();
  const inputs = await loadBenchmarkInputs(options);
  const memoryAfterIndex = memoryMiB();

  for (let pass = 0; pass < options.warmup; pass += 1) {
    runPairComparisonPass(inputs.engine, inputs.queries);
    runExhaustivePass(inputs.engine, inputs.queries);
  }

  const pairSamples = [];
  const exhaustivePassSamples = [];
  const exhaustiveQuerySamples = [];
  let checksum = 0;
  let pairOperationsPerPass = 0;
  for (let pass = 0; pass < options.iterations; pass += 1) {
    const pair = runPairComparisonPass(inputs.engine, inputs.queries);
    pairSamples.push(pair.elapsedMs);
    pairOperationsPerPass = pair.operations;
    checksum += pair.checksum;
    const exhaustive = runExhaustivePass(inputs.engine, inputs.queries);
    exhaustivePassSamples.push(exhaustive.elapsedMs);
    exhaustiveQuerySamples.push(...exhaustive.perQuery.map((sample) => sample.elapsedMs));
    checksum += exhaustive.checksum;
  }
  const memoryAfterBenchmark = memoryMiB();
  const quality = benchmarkQuality(options.iterations, {
    ...options,
    selection: inputs.selection,
  });

  return {
    schemaVersion: SOUND_BENCHMARK_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    dataset: {
      id: inputs.dataset.datasetId,
      version: inputs.dataset.datasetVersion,
      schemaVersion: inputs.dataset.schemaVersion,
      scenarioRevision: inputs.revisions.scenarios,
      split: inputs.dataset.split,
      heldOut: inputs.dataset.heldOut,
      lexiconVersion: inputs.pack.version,
      lexiconRevision: inputs.revisions.lexicon,
      lexiconEntries: inputs.engine.items.length,
      engineSourceRevision: inputs.revisions.engine,
    },
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      uv: process.versions.uv,
    },
    device: {
      label: options.device,
      powerProfile: options.powerProfile,
      os: platform(),
      osRelease: release(),
      architecture: process.arch,
      cpu: cpuManifest(),
      totalMemoryMiB: round(totalmem() / 1024 / 1024),
      freeMemoryAtReportMiB: round(freemem() / 1024 / 1024),
    },
    configuration: {
      warmupPasses: options.warmup,
      timedPasses: options.iterations,
      queryCount: inputs.queries.length,
      recommendationLimit: 25,
      recommendationMinPhonetic: 0,
      recommendationWeights: { sound: 1, meaning: 0, utility: 0 },
      timer: "node:perf_hooks performance.now wall clock",
      selection: inputs.selection,
      querySet: inputs.queries.map((query) => ({
        id: query.id,
        category: query.category,
        anchors: [query.anchor, ...query.pins],
        intent: query.intent,
      })),
    },
    quality,
    initialization: {
      ...inputs.initialization,
      lexiconBytes: inputs.bytes.lexicon,
      scenarioBytes: inputs.bytes.scenarios,
    },
    workloads: {
      pairComparisonPass: {
        operationsPerPass: pairOperationsPerPass,
        rawSamplesMs: pairSamples.map((sample) => round(sample)),
        summary: summarizeSamples(pairSamples),
      },
      exhaustiveRecommendationQuery: {
        operationsPerPass: inputs.queries.length,
        rawSamplesMs: exhaustiveQuerySamples.map((sample) => round(sample)),
        summary: summarizeSamples(exhaustiveQuerySamples),
      },
      exhaustiveRecommendationPass: {
        queriesPerPass: inputs.queries.length,
        rawSamplesMs: exhaustivePassSamples.map((sample) => round(sample)),
        summary: summarizeSamples(exhaustivePassSamples),
      },
    },
    memoryMiB: {
      beforeLoad: memoryBeforeLoad,
      afterIndex: memoryAfterIndex,
      afterBenchmark: memoryAfterBenchmark,
      rssDeltaAfterIndex: round(memoryAfterIndex.rss - memoryBeforeLoad.rss),
      rssDeltaAfterBenchmark: round(memoryAfterBenchmark.rss - memoryBeforeLoad.rss),
    },
    checksum: round(checksum, 6),
    caveats: [
      quality.minimumPassThresholdMet
        ? quality.referenceEligible
          ? "The mechanical reference-candidate requirements are met, but reference claims still require controlled conditions and a matching manifest."
          : `Not reference eligible: ${quality.ineligibilityReasons.join(" ")}`
        : `Diagnostic only: ${options.iterations} timed passes is below the ${REFERENCE_MINIMUM_TIMED_PASSES}-pass minimum; observedP95Ms is not a robust p95.`,
      "Wall-clock timings are sensitive to competing load, thermal state, and power management.",
      "Exhaustive recommendation scans the complete shipped lexicon; this is not the future indexed-search benchmark.",
      "Process memory is sampled without forcing garbage collection; deltas are post-run observations, not peak or retained-allocation measurements.",
      "Compare reports only when scenario, lexicon, engine, runtime/device, power profile, warm-up, and query-set manifests match.",
    ],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseBenchmarkArguments(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.check) {
    const inputs = await loadBenchmarkInputs(options);
    console.log(
      `Sound benchmark inputs valid: ${inputs.queries.length} deterministic stratified queries ` +
      `(intents ${inputs.selection.selectedIntents.join("/")}; pins ${inputs.selection.selectedPinCounts.join("/")}; ` +
      `max-pin ${inputs.selection.maximumSelectedPinCount}), ` +
      `${inputs.revisions.scenarios}, lexicon ${inputs.revisions.lexicon}.`,
    );
    return;
  }

  const report = await runSoundBenchmark(options);
  const json = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.stdout) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, json);
  console.log(
    `Wrote ${report.configuration.timedPasses}-pass ${report.quality.status} sound benchmark to ${options.outputPath} ` +
    `(${report.dataset.scenarioRevision}).`,
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
