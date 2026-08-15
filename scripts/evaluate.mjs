import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_LEXICON_URL,
  DEFAULT_SCENARIO_URL,
  evaluateDataset,
  loadEvaluationInputs,
  assertCoverageExpectations,
} from "../evaluation/core.mjs";
import { createRhymeEngine } from "../lib/phonetics/engine.ts";

const DEFAULT_OUTPUT = resolve("outputs/evaluation-report.json");

function usage() {
  return `Usage: npx tsx scripts/evaluate.mjs [options]

Options:
  --dataset PATH   Scenario dataset (default: evaluation/scenarios.v1.json)
  --lexicon PATH   Compact lexicon (default: public/data/cmudict.compact.json)
  --out PATH       Report path (default: outputs/evaluation-report.json)
  --stdout         Write JSON to stdout instead of a file
  --pretty         Indent JSON output
  --check          Validate schema, revisions, and coverage; write no report
  --help           Show this help`;
}

export function parseEvaluateArguments(argv) {
  const options = {
    scenarioUrl: DEFAULT_SCENARIO_URL,
    lexiconUrl: DEFAULT_LEXICON_URL,
    outputPath: DEFAULT_OUTPUT,
    stdout: false,
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
    else if (["--dataset", "--lexicon", "--out"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path.`);
      if (argument === "--dataset") options.scenarioUrl = pathToFileURL(resolve(value));
      else if (argument === "--lexicon") options.lexiconUrl = pathToFileURL(resolve(value));
      else options.outputPath = resolve(value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.stdout && options.outputPath !== DEFAULT_OUTPUT) {
    throw new Error("--stdout and --out are mutually exclusive.");
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseEvaluateArguments(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.check) {
    const inputs = await loadEvaluationInputs(options);
    const engine = createRhymeEngine(inputs.lexiconEntries);
    assertCoverageExpectations(inputs.dataset, engine);
    console.log(
      `Evaluation inputs valid: ${inputs.dataset.scenarios.length} ${inputs.dataset.split} scenarios, ` +
      `${inputs.revisions.scenarios}, lexicon ${inputs.revisions.lexicon}.`,
    );
    return;
  }

  const report = await evaluateDataset(options);
  const json = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.stdout) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, json);
  console.log(
    `Wrote ${report.dataset.scenarioCount}-scenario ${report.dataset.split} report to ${options.outputPath} ` +
    `(${report.dataset.revision}).`,
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
