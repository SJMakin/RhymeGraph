# RhymeGraph roadmap

This roadmap is ordered by uncertainty, not by feature excitement. It is a proposal for review rather than a publishing schedule.

## North-star question

> Does RhymeGraph help a writer keep or reach words they would not have found quickly with an ordinary rhyme list?

The strongest signal is not time spent admiring the graph. It is a writer inserting, pinning, or traversing through a result and continuing to write.

## Recommended sequence

### M0 — Public-alpha guardrails — shipped in v0.2.0

**Goal:** establish a safe observation baseline before inviting writers into structured sessions.

Shipped:

- the semantic model, worker, and WASM now load only after **Enable meaning**, Bridge, or a non-zero meaning mix; the explicit choice is remembered locally and sound-only sessions request none of those assets;
- pull requests run both root and `/RhymeGraph` production exports;
- Chromium runs the full semantic loop, while Chromium, Firefox, and WebKit run the sound-first keyboard smoke path;
- automated keyboard, accessible-name, visible-focus, focus-order, landmark, and heading checks cover the core loop;
- injected semantic-worker failure proves useful sound-only results remain, with retry and disable controls available;
- every browser scenario fails on a cross-origin runtime request.

**Result:** the M0 guardrail slice is shipped. It is an observation baseline, not a claim of full WCAG, screen-reader, device, or fault-injection coverage; those remain in M4.

### M1 — Evidence harness — tooling foundation shipped; human evidence pending

**Goal:** make recommendation quality measurable before tuning it.

Shipped in v0.2.0:

- a versioned scenario format for anchor, context, pins, intent, dialect, and judged candidates;
- 25 explicitly provisional, machine-assisted development fixtures spanning Continue, Bridge, and Pivot, plus multi-pin and five-anchor work;
- a plain stressed-vowel/suffix baseline and a phonetic-only RhymeGraph baseline;
- deterministic ranking snapshots and a command that produces a comparison report;
- a Node sound benchmark for lexicon initialization and exhaustive search;
- a browser benchmark for cold and repeat sound readiness, semantic readiness, reranking, worker-inclusive encoded response sizes, and renderer heap where exposed, with wire-transfer and WASM/browser-process exclusions stated;
- explicit Start / Export / Clear & stop research controls using per-page-session sessionStorage; the versioned local export contains anchors, concepts, candidate actions, settings, and timings while excluding the full draft, project title, and cursor positions; there is no telemetry or upload endpoint.

The development harness currently evaluates only a phonetic labelled candidate pool. Its fixture grades were machine-assisted and have zero human reviewers, no independent judgement, and no held-out split. Its Bridge-labelled cases exercise intent-aware phonetic ranking; they do not test semantic Bridge quality. It is suitable for evaluator regression and hypothesis formation, not an unbiased ranking or product-quality claim.

Still required:

- grow toward 150–200 independently judged cases across full rhyme, slant rhyme, assonance, consonance, multisyllabic rhyme, mosaic rhyme, pivots, multi-pin families, slang, and unknown words;
- source a separate held-out split of at least 50 scenarios and freeze it before ranking changes are tuned;
- deepen representative Bridge and Pivot coverage, including a later semantic-quality study for Bridge;
- run the benchmark protocols on controlled, named reference environments;
- conduct the formative and observed target-writer sessions below.

Use the first five target-writer sessions formatively, not as a statistical product gate. Continue to at least eight observed sessions and seek two independent judgements per evaluation scenario. Record whether writers can select an anchor, understand the three intents, insert a result, and traverse without coaching.

For the ranking gate, grade candidates `0 = unrelated`, `1 = usable`, or `2 = keep-worthy`; use the mean of the two reviewer grades for nDCG and report reviewer agreement separately; calculate nDCG on the frozen scenarios; bootstrap whole scenario IDs; collect at least 100 blinded head-to-head judgements; and report a category slice only when it contains at least 20 scenarios. A high-impact false positive is a top-three candidate that both reviewers mark unrelated, divided by all reviewed top-three slots.

**Gate:** do not declare ranking progress unless the held-out comparison improves nDCG@10 by at least .03 with a positive bootstrap confidence interval, wins at least 55% of blinded pairwise judgements, keeps high-impact false positives at or below 5%, and does not regress an eligible slice by more than .03. Advance the observed alpha when at least 80% of eight or more writers complete select → explore → insert without coaching within two minutes and at least half retain one insertion after ten minutes; otherwise investigate or simplify.

### M2 — Retrieval and vocabulary quality

**Goal:** improve the pool before adding more ranking sophistication.

Build:

- a coarse phonetic index keyed by stressed-vowel tail, syllable count, coda, and nearby vowel families so each query does not scan every entry;
- a properly licensed frequency or familiarity signal, separated from WordNet sense count;
- an OOV report driven by the golden set and real, voluntarily supplied vocabulary;
- transparent user pronunciation and phrase entries stored locally;
- better contraction, inflection, and spelling normalization;
- a larger audited phrase pack only when its provenance permits redistribution;
- explicit rhoticity handling as the beginning of a dialect profile rather than scattered exceptions;
- a comparison of calibrated raw cosine scores, the current candidate reranker, and a semantic/phonetic union retriever for Bridge;
- a small precomputed q8 word-vector experiment before introducing an approximate-nearest-neighbour dependency—the current vocabulary would require roughly 13 MiB of raw 384-dimensional q8 vectors.

Treat local G2P as a later experiment, not the first response to missing words. A guessed pronunciation is only useful if the UI labels it and evaluation shows that it improves results for the intended dialects.

Before applying a timing gate, commit a reference manifest containing CPU, RAM, OS, browser/runtime version, power mode, throttle profile, evaluation-set revision, three warm-up passes, and at least 30 timed query-set passes. Do not compare benchmark reports with different manifests as though they were the same population.

**Gate:** aim for sound-search p95 below 100 ms on the named desktop reference and 500 ms at 4× CPU throttle, with five-anchor desktop p95 below 300 ms. An indexed retrieval pool of at most 512 candidates must recover at least 99% of all exhaustive top-25 membership slots across the frozen queries before exact reranking. For Bridge, require at least +.05 nDCG@10 over sound-only candidate generation and useful recall@25 of 85%. Semantic-badge precision—the share of top-25 candidates labelled semantic that both reviewers judge related to the requested concept—must reach 80%. Vocabulary work should report coverage by category rather than one flattering aggregate number.

### M3 — Graph v2: a real neighbourhood map

**Goal:** test the original embedding-graph idea directly.

Prototype behind a view switch:

1. Return or cache embeddings for only the top 25–40 candidates.
2. Compute candidate-to-candidate edges using a documented fusion of semantic cosine distance and phonetic family distance.
3. Keep the graph sparse with local k-nearest-neighbour edges.
4. Compare a seeded force/PCA layout with a small clustering pass. Use k-means only if it adds stable, interpretable grouping; it should not determine geometry merely because it is available.
5. Preserve the ranked list as the accessible, precise representation.
6. Make cluster movement, labels, and explanations deterministic enough that the map remains learnable.

Useful experiments include colouring by relationship type, revealing semantic themes on demand, and letting pins reshape the neighbourhood. Avoid attempting a permanent global map of all 35,000 words until local neighbourhoods prove useful.

**Gate:** run a counterbalanced crossover with at least eight writers completing four tasks in each view. Graph v2 must make discovery of a useful second sound family at least 20% faster or improve retained insertion by at least 15 percentage points with a writer-level bootstrap confidence interval above zero, while median time to ordinary insertion remains within 10% of the list/current map. If it only looks more mathematically convincing, do not ship it as the default.

### M4 — Product hardening

**Goal:** make repeat use dependable across browsers, devices, and network conditions.

Build and verify:

- first-load and warm-load budgets on representative desktop and mobile hardware;
- durable cache versioning and an offline-after-first-load PWA experiment;
- graceful partial-asset failure and a visible retry path;
- Firefox, Safari/WebKit, Chromium, reduced-motion, keyboard-only, and screen-reader coverage;
- WCAG AA contrast and focus checks;
- no layout dead zone between phone, tablet, and desktop controls;
- user-controlled import/export of drafts, phrases, and pronunciation overrides;
- release/version metadata visible in diagnostics.

GitHub Pages remains suitable while the product is static. Service workers, base-path-aware assets, and cache invalidation need special care, but none requires a server.

**Gate:** the release must meet WCAG 2.2 AA, have zero serious/critical automated findings, support keyboard and screen-reader completion, reflow at 320 CSS px/400%, and remain understandable with reduced motion. The core loop must pass on current Chromium, Firefox, and WebKit plus one physical mid-range Android reference whose model, OS, thermal state, and network profile are stored with the report. First phonetic results must reach p75 ≤3 seconds cold/≤1 second warm, phonetic rerank p95 ≤100 ms after initialization, and warm WASM semantic query p95 ≤1 second. RhymeGraph's renderer and worker processes must add less than 350 MiB working set over a blank-browser baseline after semantic load. Inject missing/corrupt model, WASM, lexicon, worker, and storage states. Claim offline use only after an online → offline → update cycle passes without mixed asset versions.

### M5 — Performed cadence research

**Goal:** learn whether timing improves recommendations before building a voice product.

Start with a narrow, local experiment:

- record a known line with explicit microphone consent;
- align the known words to timing rather than asking a model to invent the transcript;
- extract onset, duration, pause, and emphasis features;
- compare cadence-aware replacement ranking against the text-stress baseline;
- try browser/system TTS only as an audition aid, with clear voice variability across operating systems.

Only then evaluate a small local STT model for freestyle capture. Remote speech APIs would change the privacy promise and are not an assumed fallback.

**Gate:** across at least 100 blinded paired judgements, cadence-aware ranking must beat the text-stress baseline at least 55% of the time with a writer-level bootstrap confidence interval above zero and no eligible evaluation slice regressing by more than .03 nDCG@10. Otherwise keep cadence as research rather than product scope.

### M6 — Optional knowledge layers

Etymology, definitions, lexical relations, dialect provenance, and word-history links could make traversal richer. Add them as independently versioned local packs after the core writing loop proves retention. Each layer needs a data-licensing, payload, and visual-noise audit.

## Now / next / later

| Now | Next | Later |
| --- | --- | --- |
| Independently review and broaden the provisional development set | Indexed phonetic retrieval | Known-text cadence spike |
| Source and freeze the separate held-out split | Frequency and vocabulary work | Local STT feasibility |
| Run controlled Node/browser reference benchmarks | Semantic/phonetic union retrieval | TTS audition mode |
| Five formative writer sessions using manual local exports | Graph v2 experiment | Etymology and knowledge layers |
| Decide project licence, explicit-vocabulary policy, and first dialect target | User phrases, pronunciations, and dialect foundation | Any account, sharing, or publishing features |
| Maintain v0.2.0 root/Pages/cross-browser guardrails | Broader accessibility/device hardening | Global corpus graph, only if local Graph v2 wins |

## Delivered implementation slices

**M0 — Guardrails**, shipped in v0.2.0:

1. Root and Pages-subpath exports are both protected on pull requests.
2. Firefox and WebKit sound-loop smoke coverage accompanies the full Chromium path.
3. Keyboard/accessibility assertions, same-origin audits, and semantic-worker failure injection protect the core loop.
4. The owner's on-demand semantic-loading decision is implemented: Enable, Bridge, or a non-zero meaning mix starts the local stack; sound-only use fetches no model/WASM; the preference is remembered locally.

**M1 — Evidence tooling foundation**, shipped in v0.2.0:

1. `evaluation/scenarios.v1.json` and its documented schema contain 25 provisional development scenarios; they are explicitly excluded from the later held-out split.
2. `npm run evaluate` compares the current phonetic engine with a stressed-vowel/suffix baseline and writes a machine-readable labelled-pool report.
3. `npm run benchmark:sound` records lexicon/search timings and `npm run benchmark:browser` records the production runtime; both reports include revision and environment context.
4. **Start research session** explicitly begins per-page-session capture in sessionStorage; **Export research session** downloads a versioned JSON file locally; **Clear & stop** removes the capture. It records research-relevant actions and timings, excludes the full draft and project title, and performs no upload.
5. The evaluation data remains deliberately provisional. Independent review, held-out evidence, controlled benchmark runs, and target-writer sessions are the next work—not claims attached to the tooling itself.

These slices make the public alpha safer to observe and create the instrumentation needed to choose between ranking, vocabulary, and graph work. They do not yet answer the north-star question.

## Decisions needed from the owner

None blocks the evidence harness, but these should be settled before a broader public invitation:

1. **Project licence:** the repository is public but currently has no top-level licence; public source is not automatically open source.
2. **Explicit vocabulary:** uncensored by default, filtered by default, or a remembered local control.
3. **First dialect target:** deepen General American, add a UK profile, or choose a narrower scene/community with reviewers.
4. **Future research submission:** v0.2.0 is local/manual export only; whether a separate explicit opt-in submission path should ever exist remains undecided.
