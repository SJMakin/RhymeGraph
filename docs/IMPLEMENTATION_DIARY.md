# RhymeGraph implementation diary

This is a record of product and engineering decisions, the evidence behind them, and the things the prototype has not proved. It is deliberately not a changelog: commits say what changed; this diary says why. The first entry is a retrospective reconstructed from the 3–4 August build session, the resulting code, and commits `07d184a` and `aea4ca6`.

## Current snapshot

**Date:** 11 August 2026

**Status:** v0.2.0 public-alpha guardrails and evidence-tooling foundation

**Live build:** [sjmakin.github.io/RhymeGraph](https://sjmakin.github.io/RhymeGraph/)  
**Source:** [github.com/SJMakin/RhymeGraph](https://github.com/SJMakin/RhymeGraph)

| Area | Current state |
| --- | --- |
| Product | A writing workspace with graph and ranked-list views |
| Sound retrieval | Stress-aware phonetic search in a dedicated browser worker |
| Meaning | Explicit, on-demand local `all-MiniLM-L6-v2` inference in a second browser worker; preference remembered locally |
| Vocabulary | 35,510 General American entries, 39,175 pronunciations, and 8 authored phrase fixtures |
| Persistence | Draft/title/workspace state in localStorage; explicitly started research capture in per-tab sessionStorage; on Pages, both APIs are scoped to the shared `sjmakin.github.io` origin rather than isolated by repository path |
| Hosting | Static Next.js export on GitHub Pages at `/RhymeGraph/` |
| Runtime services | None; no rhyme, embedding, account, or analytics API |
| Verification | Unit/data checks; root and Pages production paths; Chromium full loop; Firefox/WebKit sound-loop smoke; keyboard, same-origin, and semantic-failure guardrails |
| Evidence | Versioned provisional labelled-pool evaluator, sound/browser benchmark protocols, and manual privacy-safe research-session export |

The generated lexicon is about 1.43 MiB. The quantized ONNX model itself is about 21.9 MiB; model, tokenizer, ONNX runtime, and WASM together make the progressive semantic path roughly 45.8 MiB uncompressed. The sound engine starts first. The semantic module, worker, model, and WASM remain unfetched until the writer enables meaning, chooses Bridge, or raises the meaning mix; that explicit choice is remembered in local browser storage.

## 4 August 2026 — From specification to working instrument

### 1. The product boundary came first

The initial idea could easily have become a rhyme API with a graph drawn over it. We fixed a different boundary:

- the draft is the primary object;
- the graph is a way to move through possibilities, not an end in itself;
- sound and meaning remain separate signals until late ranking;
- the writer chooses the intent: **Continue**, **Bridge**, or **Pivot**;
- the first release has no account, server, or proprietary runtime dependency.

That boundary made the rest of the architecture much clearer. The application can be hosted as static files and the user's writing stays in the browser.

### 2. The pronunciation pack became a reproducible build product

The browser does not parse a full dictionary at startup. `scripts/build-lexicon.mjs` converts pinned source packages into a compact pack containing:

- CMU pronunciations that the scoring engine can represent;
- Princeton WordNet-derived part-of-speech and lexical-utility metadata;
- a small, explicit set of spoken and rap-oriented overrides;
- eight authored phrase fixtures used to prove cross-word alignment;
- version, source, and dialect metadata.

The first useful lesson was that source size is not coverage quality. Filtering removes much of CMUdict's noise, but it also leaves a 35,510-word vocabulary with predictable gaps in slang, inflections, names, and dialect spellings. That is now an evaluation problem, not something the UI should disguise.

For the vertical slice, sound retrieval scans the full shipped vocabulary inside its worker and returns up to 72 candidates. The retrieval signature/index proposed in the specification is not implemented yet. This kept v0.1 simple and correct enough to inspect, at the cost of query latency.

A post-launch Node diagnostic over 24 representative cases measured engine initialization at 371 ms and about 33.6 MiB additional heap; searches had a 291 ms median, 859 ms p95, and a 1,793 ms maximum for a five-anchor case. That materially misses the specification's aspirational sub-100 ms p95. The diagnostic now needs to become a versioned benchmark rather than remain a one-off audit.

### 3. Loose rhyme was modelled as evidence, not a single label

The sound engine represents ARPABET phonemes, lexical stress, syllable shape, codas, and word boundaries. It scores several signals independently:

- stressed-vowel similarity and assonance;
- consonance;
- final coda preservation;
- full-tail similarity;
- stress and cadence alignment;
- multi-anchor family consistency.

This matters because a useful rap rhyme is often connected strongly along one dimension and loosely along another. The UI can explain that relationship instead of pretending every result is either a perfect rhyme or a failure.

Multi-pin search uses one pronunciation of each candidate across the whole family. During testing, this caught an important false-positive mode: an ambiguous spelling must not use one pronunciation against one pin and a different pronunciation against another. Rhotic vowels also needed explicit distance handling so pairs such as “love” and “serve” were not presented as full rhymes.

### 4. Meaning was kept local and optional

The semantic worker runs a quantized 384-dimensional MiniLM model through Transformers.js and ONNX Runtime Web. Remote model access is disabled in code. If any local model asset is missing or initialization fails, RhymeGraph remains a sound-only instrument.

The v0.1 semantic pass embedded the query and up to 72 phonetic candidates, computed cosine similarity, and reranked those candidates. It did **not** ship a precomputed embedding for every dictionary entry, sense, or gloss. Princeton WordNet was used only during the lexicon build as a lemma, part-of-speech, and sense-count source. v0.2.0 retains that ranking boundary while changing when the semantic stack loads.

This reveals a structural limitation in **Bridge**: meaning can reorder the sound-generated pool, but it cannot retrieve a useful semantic bridge that falls outside the top 72 by sound. The UI also min-max normalises each semantic batch, so when scores differ the batch leader is rescaled to 100 even if every raw cosine is weak. Both behaviours need evaluation and calibration before the semantic score should be read as confidence.

This is fast enough to make the interaction convincing on the machines tested so far, but perceived speed is not yet a benchmark. Cold transfer, initialization, inference, memory, and low-end mobile behaviour still need to be measured separately.

One live Chromium sample on the development machine reached DOM content at 3.23 seconds, sound readiness at 4.21 seconds, semantic readiness at 8.75 seconds, and a combined reranked result at 10.39 seconds from cold caches. A warm reload reached the same points at 0.06, 0.56, 2.82, and 5.20 seconds. These are diagnostic observations from one environment, not performance claims or release budgets.

### 5. The graph deliberately shipped before “Graph v2”

The current graph lays out the returned neighbourhood deterministically by relationship, score, and a stable word-derived offset. It supports selection, insertion, pinning, and traversal without allowing nodes to jump around between renders.

It is important to state what it is not: this first graph is not a global k-means map and its edges are not candidate-to-candidate embedding similarities. It proved the interaction and visual language first.

A true neighbourhood graph is now feasible without changing the product boundary: retain embeddings for the top candidate set, form a small local k-nearest-neighbour graph using phonetic and semantic distances, and compare that view with the current layout. That work belongs behind an evaluation gate because a mathematically faithful map can still be a worse writing tool.

### 6. The interface became a writing loop

The vertical slice includes:

- selection- or caret-derived anchors inside the draft;
- graph and ranked-list views;
- Continue, Bridge, and Pivot recommendation intents;
- up to five total family anchors: the active word plus as many as four pins;
- sound/meaning balance and simple lexical filters;
- candidate explanations, pronunciation, and component scores;
- insert, expand, pin, undo, breadcrumbs, and keyboard actions;
- responsive desktop, tablet, and phone layouts;
- browser-local restoration of the draft and active anchor;
- explicit empty and sound-only states.

The most valuable UI fixes came from trying the actual loop at awkward widths and after reload. That exposed stale results for unknown words, restored drafts with the wrong insertion anchor, and a tablet range with no visible insertion action. Those were product failures despite the underlying engine being correct.

A final data audit exposed two scoring faults. First, a word such as `constructor` could inherit a property from `Object.prototype` when no semantic score existed, turn its combined score into `NaN`, and destabilise the ordering. Semantic lookup now accepts only finite, own properties, with a regression asserting that every returned score is finite and monotonically ordered. Second, two open-vowel rhyme tails were receiving perfect consonance and coda scores because both consonant sequences were empty. Missing components are now excluded and the available evidence is renormalised; `flow`/`go` remains a full rhyme while `flow`/`yeah` is no longer promoted as consonance or slant rhyme.

### 7. Release hardening treated privacy as a testable property

The release path now checks more than whether the page renders:

- unit tests cover phonetic relationships, phrases, multi-pronunciation families, serialization, cosine ranking, and failure cases;
- browser tests run both local engines and exercise the writing loop;
- responsive tests require insertion to remain available at desktop, tablet, and phone widths;
- the core-loop browser test records runtime requests and fails if the application contacts an origin other than the one serving it;
- third-party notices and the relevant licence texts are published with the build;
- the exact GitHub Pages subpath export is built and browser-tested before deployment.

The deployment initially failed because GitHub Pages had not yet been enabled for Actions. Selecting **Settings → Pages → Source → GitHub Actions** and sending a fresh push created the site. The successful workflow then built, tested, uploaded, and deployed the same artifact now served publicly.

## 4 August 2026 — Post-launch evidence review

**Question:** is the attractive, responsive vertical slice already a validated recommendation product?

**Evidence:** the code, data, live network path, browser behaviour, and ranking outputs were audited independently. The public build is healthy and entirely same-origin. A cold/warm browser sample and an exhaustive-search diagnostic established the first performance baselines. The audit also found and reproduced the inherited semantic-score fault described above.

**Decision:** call v0.1 a credible public alpha, not a validated product. Preserve the architecture and visual direction, fix correctness defects immediately, and make v0.2 an evidence milestone before expanding into voice or global graph work.

**Trade-off:** the next iteration will add less visible surface area than a voice or clustering demo, but it will tell us whether later sophistication is improving a writer's choices.

**Follow-up:** build the golden-set evaluator, repeatable performance harness, and local research export described in the [roadmap](./ROADMAP.md); decide the semantic loading policy before deliberately driving wider traffic.

## 10–11 August 2026 — Guardrails and evidence tooling before ranking claims

**Question:** how can the public alpha remain fast and trustworthy for sound-only writing while creating enough reproducible evidence to decide what deserves improvement next?

**Change:** v0.2.0 made semantics an explicit progressive enhancement. Sound search starts immediately; the semantic module, worker, model, and WASM load only after **Enable meaning**, Bridge, or a non-zero meaning mix. The writer's choice is remembered locally, loading can be cancelled, and a ready or failed semantic path can be disabled back to sound only. Semantic loading is deliberately shown as indeterminate: Transformers.js 4.2's numeric progress callback performed a full local-file metadata fetch before the real model fetch, transferring the 22.97 MB ONNX model twice. Removing that callback restored one model transfer without weakening the local-only boundary. The settings panel now provides explicit **Start research session**, **Export research session**, and **Clear & stop** controls. Capture exists only after Start and uses sessionStorage for the current page session. Its versioned JSON includes anchors, concepts, candidate actions, view/settings changes, and timings, while excluding the full draft, project title, and cursor positions; the app has no upload endpoint.

The release checks now exercise root and GitHub Pages production paths. Chromium covers the full semantic writing loop; Chromium, Firefox, and WebKit cover the sound-first keyboard loop. Each browser scenario audits runtime requests for unexpected origins. Lightweight accessibility assertions cover names, focus, focus order, landmark, and heading structure, and an injected semantic-worker failure must preserve useful sound results.

The evidence slice adds a versioned schema and 25-scenario provisional development set spanning Continue, Bridge, Pivot, multi-pin families, and a five-anchor workload. `npm run evaluate` compares the current phonetic scorer with a plain stressed-vowel/suffix baseline over the machine-assisted labelled development pool. `npm run benchmark:sound` records versioned Node initialization/search/memory observations, while `npm run benchmark:browser` records cold and repeat production readiness, worker-inclusive encoded response sizes, and available renderer heap. The report labels those byte observations as encoded bodies/headers rather than complete wire-transfer totals. Their JSON reports live under ignored `outputs/` paths so a local run does not become an unexplained repository claim.

**Evidence:** automated browser checks prove that a sound-only session requests zero semantic model/WASM assets, the local preference drives repeat startup, semantic failure leaves the sound loop usable, and all observed application requests remain same-origin. The evaluator and both benchmark commands produce revisioned, machine-readable reports; the evaluator and sound benchmark also have check-only validation paths for CI, where timing would be meaningless. The research export records insertion, undo, pin, traversal, map/list, engine, and timing events without recording the draft or sending a network request.

The first 118-label development run scored the current phonetic engine at `.951801` nDCG@3 and `.956988` nDCG@10, versus `.935200` and `.946271` for the documented suffix baseline. Reciprocal rank was `.92` versus `.90`, and the provisional top-three high-impact false-positive rate was `0` versus `.027778`. These grades were machine-assisted and have zero human reviewers. The nDCG@10 delta is only `.010717`, below the roadmap's `.03` held-out improvement gate, and this run has neither independent review nor confidence intervals. It verifies that the evaluator can expose a small difference; it is not evidence that the ranker has cleared the product gate.

A fresh Chromium run against the v0.2.0 production export observed cold DOM, sound, meaning, and combined-result readiness at `657`, `2,371`, `13,379`, and `19,861 ms`. In the same browser context, a cached repeat observed `298`, `2,205`, `6,278`, and `9,898 ms`. The sound-only phase made zero semantic requests. Opting in transferred one `22,972,370`-byte ONNX body and `47,299,486` bytes of semantic model/runtime bodies in total; including the separately observed worker script puts the optional path at about `45.6 MiB`. All 24 cold and 17 repeat requests finished with no failure, while repeat semantic bodies came from cache. These are one-machine protocol observations, not portable latency or memory claims.

A 30-pass, three-warm-up sound reference candidate on the 2-core/4-thread i7-7500U development laptop covered all available intent and pin-count strata. Engine indexing took `391.021 ms`; 180 exhaustive query samples observed a `1026.13 ms` median, `3303.119 ms` p95, and `9107.142 ms` maximum. Post-run process RSS was `814.813 MiB` above the pre-load sample, measured without forced garbage collection and therefore not a peak or retained-allocation claim. The run mechanically satisfies the benchmark manifest but materially misses the roadmap's search budgets; it makes indexed retrieval the next engine priority.

This is infrastructure evidence, not recommendation validation. The evaluation set is machine-assisted and provisional, has zero human reviewers and no held-out split, and reranks a phonetic labelled candidate pool rather than measuring full-vocabulary retrieval. Bridge-labelled cases exercise intent-aware phonetic ranking; they do not establish semantic Bridge quality. Benchmark output remains machine- and protocol-specific. No structured target-writer session has yet answered whether the suggestions improve writing.

**Decision:** mark M0 public-alpha guardrails as shipped and M1 evidence tooling as a shipped foundation, with human and held-out evidence still pending. Keep sound as the default usable instrument and semantics as an explicit local bandwidth choice. Keep the current graph as a stable star-shaped projection of one ranked neighbourhood; do not describe it as a global embedding graph, corpus cluster map, or candidate-to-candidate similarity graph.

**Debt introduced:** the provisional set needs independent reviewers, more balanced intent/category coverage, and a separately sourced frozen split; Bridge needs a semantic-quality study rather than phonetic intent fixtures alone. The benchmark protocols need controlled reference-device runs before budgets are enforced. The manual research file still requires a consenting writer to start capture, inspect the file, and deliberately share it outside the app. Persisted drafts and semantic preference remain in origin-scoped localStorage, while active research capture uses per-tab sessionStorage; on GitHub Pages, `/RhymeGraph` is not a separate storage boundary from other `sjmakin.github.io` pages for either API. Automated accessibility checks do not replace screen-reader, reduced-motion, 320 px/400%, or physical-device testing.

## What this prototype proved

1. A functional, explainable phonetic search can run over tens of thousands of entries entirely in-browser.
2. A compact local embedding model can add semantic direction without a third-party service.
3. Sound-only fallback is a viable product state rather than a fatal error.
4. Multi-pin, Continue/Bridge/Pivot, and graph traversal form a coherent writing interaction.
5. The whole application fits a static-hosting and local-first privacy model.
6. The visual system is strong enough to make a complex engine approachable.

## What it has not proved

1. That target writers prefer its suggestions to a conventional rhyme dictionary.
2. That the current ranking is consistently useful across a representative set of anchors and lyric contexts.
3. That graph traversal causes more useful discoveries than the ranked list alone.
4. That the vocabulary and pronunciation assumptions cover real rap writing, regional speech, and code-switching well enough.
5. That the semantic payload and inference path are acceptable on low-end phones and slower networks.
6. That speech timing improves recommendations enough to justify the complexity of STT/TTS.

Those are the next questions. Adding more surface area before answering them would make the product larger without making the core claim more certain.

## Decision record

| Decision | Reason | Revisit when |
| --- | --- | --- |
| Local-first, static runtime | Privacy, self-hostability, and no service dependency | A proven feature strictly requires a server |
| General American pack labelled `en-US` | Best licensed starting data, not a claim of universal English | A second audited dialect pack exists |
| Separate phonetic and semantic workers | Failure isolation and responsive UI | Profiling shows worker overhead dominates |
| Late fusion of sound, meaning, and utility | Preserves explainability and user control | Golden-set evidence supports another ranker |
| Quantized MiniLM baseline | Small enough to establish local semantic feasibility | A measured alternative wins quality/latency/size |
| No guessed pronunciation for unknown words | Avoid confident but misleading phonetic claims | An evaluated, dialect-aware G2P path exists |
| Authored phrase fixtures only | Proves mosaic alignment without dubious corpus rights | A redistributable phrase source is audited |
| Stable relationship-led graph layout | Proves the interaction before graph mathematics | Graph v2 beats it in writer sessions |
| Semantic stack loads on demand | Sound-first speed and an explicit roughly 46 MiB local bandwidth choice | Evidence supports a smaller model or another transparent policy |
| Explicit, session-scoped local research export only | Supports formative sessions without passive telemetry, persistent capture, or draft capture | A separate, explicit submission study is approved |
| Voice deferred | Typed recommendation quality is the prerequisite | The typed loop clears its validation gate |
| GitHub Pages deployment | Simple static hosting fits the architecture | The owner chooses another publishing arrangement |

## Open decisions

These have intentionally not been guessed:

- the licence for RhymeGraph's own source code;
- default handling of explicit vocabulary;
- which dialect or regional pack should follow `en-US`;
- whether any future, separately consented research submission path should exist; v0.2.0 only downloads a manual local file;
- future publishing, sharing, custom-domain, or account behaviour.

## Format for future entries

Each substantial iteration should add a dated entry containing:

1. **Question** — what uncertainty were we trying to reduce?
2. **Change** — what was built or tested?
3. **Evidence** — benchmark, evaluation set, user observation, or failure report.
4. **Decision** — keep, revise, remove, or defer.
5. **Debt introduced** — shortcuts and their explicit trigger for repayment.
