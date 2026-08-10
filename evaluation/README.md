# RhymeGraph evidence harness

This directory contains evaluation inputs, not product data. Version 1 is a
small development set for exercising the evaluator and exposing obvious
ranking mistakes before independently judged material exists.

## What the data does and does not mean

`scenarios.v1.json` contains exactly 25 **development** scenarios. They were
machine-assisted from the shipped lexicon and existing engine fixtures, have
zero human reviewers, and are explicitly `heldOut: false`. They may be used to
debug the evaluator or form hypotheses. They must not be used to claim model
quality, tune a system and then report an unbiased gain, or stand in for the
frozen double-reviewed set described in the roadmap.

Dataset v1.1 contains 21 Continue, 2 Bridge, and 2 Pivot scenarios. Pin counts
are 22 unpinned scenarios plus one each with 1, 2, and 4 pins; the last is the
five-anchor workload. This distribution exercises product paths but is not
balanced enough for per-intent quality claims. Bridge grades may use their
authored context, while the current command supplies no embeddings or semantic
scores to either comparator. Its Bridge results therefore measure only the
phonetic side of those pools and must not be presented as semantic quality.

Candidate grades follow the project's intended research scale:

- `0`: unrelated or unsuitable for the stated intent;
- `1`: usable loose relationship;
- `2`: keep-worthy relationship.

The grade is intent-aware. For example, an exact rhyme may receive `0` in a
Pivot scenario because it fails to move the writer to a neighbouring family.
`relationships` describes the audible mechanism and is independent of the
utility grade.

## Versioned schema

`scenario-schema.v1.json` is the normative JSON Schema. A dataset records its
schema and dataset versions, split, held-out status, judgement state, and
provenance. Every scenario records an anchor, optional context, pinned anchors,
intent, dialect, expected lexicon coverage, category, and candidate
judgements. The evaluator also performs semantic checks that JSON Schema alone
does not express: unique IDs and candidates, no anchor repeated as a candidate,
split consistency, and honest held-out/judgement combinations.

Changing field meaning requires a new schema version. Changing scenarios or
grades requires a new `datasetVersion`; never silently rewrite a frozen set.

## Evaluator

Run the package command:

```text
npm run evaluate
node --experimental-strip-types scripts/evaluate.mjs --pretty --out outputs/evaluation-report.json
```

The report compares two deterministic scorers over each scenario's
machine-assisted provisional candidate pool:

1. `stressed-vowel-suffix-v1`: exact primary-stressed-vowel identity plus the
   shared ARPAbet suffix length; no learned weights or semantic data.
2. `rhymegraph-phonetic-v0.1`: the current engine with sound weight `1`, other
   weights `0`, and no phonetic cutoff.

It reports nDCG@3, nDCG@10, first keep-worthy reciprocal rank, top-three
unrelated rate, coverage, per-scenario rankings, and dataset/engine/evaluator hashes.
These are **unreviewed development-pool reranking** metrics. They do not measure
human judgement or retrieval from the full 35k-word lexicon. An unknown anchor
counts as zero in the all-scenario
aggregate and is also separated in covered-only metrics. Reports record intent
and pin-count distributions plus maximum anchor count so future fixture edits
cannot silently reduce path coverage.

JSON is written to the ignored `outputs/evaluation-report.json` by default.
`--out PATH` chooses another file, `--stdout` emits machine-readable JSON
instead, and `--pretty` only changes formatting. `npm run evaluate -- --check`
validates the schema, split metadata, revisions, and declared lexicon coverage
without writing a report; validation failures exit non-zero for CI.

## Sound benchmark

Run a quick local benchmark with the default manifest, or the roadmap's fuller
30-pass reference form:

```text
npm run benchmark:sound
node --experimental-strip-types scripts/benchmark-sound.mjs --iterations 30 --warmup 3 --device "Desktop reference" --power-profile "AC, balanced"
```

The benchmark records Node/V8, OS, architecture, CPU, logical cores, memory,
device label, power-profile label, lexicon/scenario revisions, query set,
warm-ups, timed passes, initialization stages, pair-comparison latency,
exhaustive recommendation latency, and process memory. It makes no network
requests and uses the same lexicon conversion and engine as the browser worker.

Do not compare reports whose dataset revisions, runtime/device manifests,
power profiles, warm-ups, or query sets differ as if they were the same
population. Timings are wall-clock measurements and remain sensitive to load,
thermal state, and power management.

The default is a quick six-query, two-warm-up, five-pass report at the ignored
`outputs/sound-benchmark.json`. Its deterministic stratified selector covers
available intent and pin-count strata before filling category diversity, and
always includes a maximum-pin workload when one exists. Use `--stdout` for a
JSON stream. The benchmark also accepts `--check`, which validates both
versioned inputs, declared anchor coverage, and deterministic query selection
without recording meaningless CI timings.

Any report with fewer than 30 timed query-set passes labels itself
`diagnostic`; its `observedP95Ms` is an observed diagnostic percentile, not a
robust p95 estimate. At 30 or more passes the report becomes a
`reference-candidate`, but only a controlled run with a complete, matching
manifest supports comparison or a tail-latency claim.

## Local research export

Opted-in research exports use the non-retrievable schema identifier
`urn:rhymegraph:research-session:1`. Their checked JSON Schema lives at
[`research-session-schema.v1.json`](./research-session-schema.v1.json); it is a
repository artifact, not a promise of a canonical web host.
