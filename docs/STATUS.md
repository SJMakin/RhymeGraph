# RhymeGraph implementation status

This is the compact source of truth for what v0.2.0 implements. [SPEC.md](../SPEC.md) records the original product and technical design; the [implementation diary](./IMPLEMENTATION_DIARY.md) explains the decisions and discoveries behind the current slice.

| Capability | Status | v0.2.0 evidence | Next gate |
| --- | --- | --- | --- |
| Local-first static application | Shipped | Static Next export; same-origin runtime assets; no rhyme, account, analytics, or research-upload API | Preserve the boundary in every production scenario |
| Stress-aware loose-rhyme scoring | Shipped | Assonance, consonance, coda, tail, stress, mosaic, and false-positive regression coverage | Beat the documented baseline on independently judged, held-out scenarios |
| Multi-pin family search | Shipped | Up to five anchors; one consistent candidate pronunciation across the family | Blinded comparison with the best single anchor |
| Continue / Bridge / Pivot | Shipped | Deterministic intent-aware engine and UI paths | Add representative Bridge/Pivot evidence and test target-writer comprehension |
| Pronunciation vocabulary | Partial | 35,510 `en-US` entries, 39,175 pronunciations, curated slang overrides | Measured OOV coverage and reviewed dialect expansion |
| Phrase and mosaic search | Partial | Word-boundary-aware composition and 8 authored fixtures | Audited redistributable phrase source or user-local phrases |
| Indexed retrieval | Deferred | Current worker scans the full lexicon and returns up to 72 candidates | Equivalent accepted pool with materially lower p95 latency |
| Local semantic ranking | Shipped, explicit progressive path | q8 MiniLM, 384 dimensions, single-thread WASM, remote models disabled; loads only after Enable, Bridge, or a non-zero meaning mix | Independently measured quality/latency/payload comparison with alternatives |
| Sound-only startup | Shipped | Browser and benchmark assertions require zero model, semantic-worker, and semantic-WASM requests before opt-in | Preserve across caching and future worker changes |
| Remembered semantic choice | Shipped | Explicit opt-in is stored locally; loading can be cancelled and a ready/error state can be disabled back to sound only | Test storage denial and version/migration behaviour |
| Whole-vocabulary/sense embeddings | Deferred | Current worker embeds the query and phonetic candidate set at request time | Only add if evaluation shows candidate generation needs semantics |
| Interactive graph | Shipped, simplified | Stable on-demand star neighbourhood with graph/list traversal | Graph v2 must beat the current star/list views in writing sessions |
| Candidate-to-candidate embedding graph | Deferred | No global clusters or candidate-similarity edges in v0.2.0 | Local k-nearest-neighbour prototype over top candidates |
| Draft workflow and persistence | Shipped | Selection anchor, insert, expand, pin, insertion undo, traversal breadcrumbs, and local restoration | Draft import/export, real draft history, and a storage-isolation choice beyond shared-origin Pages localStorage |
| Manual research export | Shipped, formative | Explicit Start / Export / Clear & stop controls; per-page-session capture in sessionStorage; versioned JSON includes anchors, concepts, candidate actions, settings, and timings while excluding the full draft, project title, and cursor positions; no upload | Use in observed sessions and review whether its fields answer the study questions |
| Responsive interaction | Shipped for tested widths | Production browser checks cover desktop, tablet, and phone viewports | Wider physical-device matrix |
| Accessibility | Partial | Cross-browser keyboard completion plus automated accessible-name, focus-order, landmark, heading, and visible-focus checks | WCAG 2.2 AA, screen-reader, reduced-motion, and 320 px/400% audit |
| Failure isolation | Shipped for semantic-worker path | Injected semantic-worker failure preserves sound results; UI exposes retry or sound-only controls; stale work is superseded | Inject corrupt model, WASM, lexicon, storage, and worker states |
| Runtime privacy | Shipped for v0.2.0 scope | Every browser scenario rejects cross-origin runtime requests; sound-only startup fetches no semantic stack; research data is manual/local only | Decide separately whether any future submission path should exist |
| Browser-storage boundary | Documented limitation | Persisted drafts and the semantic preference use origin-scoped localStorage; active research capture uses per-tab sessionStorage; GitHub Pages isolates neither API by the `/RhymeGraph` repository path | Reassess hosting/storage design before treating browser persistence as site-isolated |
| Offline-after-first-load guarantee | Deferred | Assets are static/local-origin, but no service worker is shipped | Versioned-cache PWA experiment with update testing |
| Evaluation harness | Tooling foundation shipped | Versioned schema and deterministic evaluator; 25 provisional machine-assisted development fixtures across all three intents, including multi-pin and five-anchor work; zero human reviewers and no held-out split | Independent double review, representative intents/categories, and a separately sourced frozen split |
| Sound benchmark | Tooling foundation shipped | Versioned Node report for initialization, pair comparison, exhaustive search, and process memory; check-only mode for CI | Controlled reference manifest and repeated isolated runs before enforcing budgets |
| Browser benchmark | Tooling foundation shipped | Production-export report for cold/repeat sound and meaning readiness, worker-inclusive encoded response sizes, and available renderer heap | Representative hardware runs; encoded sizes are not wire-transfer totals, and renderer heap excludes WASM/browser-process memory |
| Target-writer validation | Deferred | No structured target-writer study yet | Formative sessions using the manual local export, then the roadmap's observed-session gate |
| Dialect packs and local G2P | Deferred | Pack is explicitly labelled `en-US`; no guessed OOV pronunciation | Audited profile and blinded pronunciation review |
| STT, cadence, and TTS | Deferred | UI language only hints at future performed-cadence work | Timing features beat text-stress baseline before product work |
| Etymology/knowledge layers | Deferred | Basic POS and sense-count metadata only | Licensed, payload-audited optional pack |
| Public-alpha guardrails (M0) | Shipped | Root and `/RhymeGraph` production paths, same-origin audit, Chromium full loop, Firefox/WebKit sound-loop smoke, keyboard checks, and semantic failure isolation | Keep these checks green as evidence work changes the engine |
| GitHub Pages release | Shipped | Pull requests test both root and `/RhymeGraph` exports; the deploy workflow tests the Pages artifact | Add cache/version discipline before offline support |

## Evidence artefacts

| Artefact | What it records | Interpretation limit |
| --- | --- | --- |
| `evaluation/scenarios.v1.json` | 25 versioned provisional scenarios and 118 machine-assisted candidate labels across Continue, Bridge, Pivot, and 1–5-anchor families | Zero-human-review phonetic fixture data; not a Bridge semantic-quality test, held-out evidence, or product validation |
| `outputs/evaluation-report.json` | Baseline/current labelled-pool rankings, nDCG, reciprocal rank, false-positive rate, coverage, and revision hashes | Machine-assisted fixture reranking only; not human-reviewed or full-vocabulary retrieval quality |
| `outputs/sound-benchmark.json` | Runtime/device manifest, input revisions, warm-ups, timed passes, initialization, search, and process-memory observations | Environment-sensitive; sub-30-pass runs are diagnostic only |
| `outputs/browser-benchmark.json` | Cold/repeat DOM, sound, meaning, combined readiness, BrowserContext encoded body/header sizes including worker requests, and available renderer heap | One production-browser protocol; encoded sizes are not wire-transfer totals, cache reporting varies, and renderer heap excludes WASM/browser-process overhead |
| Manual research-session JSON | Explicitly started, page-session interaction summary and event sequence with schema/app versions | Formative trace supplied by the writer; sessionStorage capture only, no upload, and no behavioural outcome claim |

Generated files under `outputs/` are intentionally ignored. Benchmark numbers should be cited only with the matching device, power, runtime, revision, warm-up, and pass manifest. v0.2.0 establishes repeatable instrumentation; it does not establish final performance budgets or ranking quality.

The first 30-pass sound reference candidate used a Windows/i7-7500U/8 GiB development laptop on the Balanced scheme, with AC/battery state unavailable. Across 180 exhaustive query samples spanning all available intent and pin-count strata, it observed `1026.13 ms` median, `3303.119 ms` p95, and `9107.142 ms` maximum latency. Post-run RSS delta was `814.813 MiB` without forced garbage collection. These results miss the roadmap budgets and motivate indexed retrieval; they are a manifest-bound observation, not a device-wide performance claim.
