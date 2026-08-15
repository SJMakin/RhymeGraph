# RhymeGraph implementation diary

This is a record of product and engineering decisions, the evidence behind them, and the things the prototype has not proved. It is deliberately not a changelog: commits say what changed; this diary says why. The first entry is a retrospective reconstructed from the 3–4 August build session, the resulting code, and commits `07d184a` and `aea4ca6`.

## Current snapshot

**Date:** 15 August 2026

**Status:** v0.3.0 content/retrieval/explorer implementation candidate; production and human validation pending

**Live build:** [sjmakin.github.io/RhymeGraph](https://sjmakin.github.io/RhymeGraph/)  
**Source:** [github.com/SJMakin/RhymeGraph](https://github.com/SJMakin/RhymeGraph)

| Area | Current state |
| --- | --- |
| Product | A writing workspace with a family-first explorer, optional local phonetic map, and ranked list |
| Sound retrieval | Multi-channel indexed shortlist plus exact stress-aware 1–6-syllable suffix-window scoring in a browser worker |
| Meaning | Explicit, on-demand query-only `all-MiniLM-L6-v2` inference over a local full-vocabulary int8 index; semantic/phonetic union and late fusion |
| Vocabulary | 54,132 compact words, 59,783 pronunciations, 8 pack fixtures, and 151 runtime-authored ordinary performance-phrase building blocks |
| Pronunciation profiles | CMU-based General American source plus a selectable, persisted UK non-rhotic beta scoring transform |
| Persistence | Draft/title/workspace state in localStorage; explicitly started research capture in per-tab sessionStorage; on Pages, both APIs are scoped to the shared `sjmakin.github.io` origin rather than isolated by repository path |
| Hosting | Static Next.js export on GitHub Pages at `/RhymeGraph/` |
| Runtime services | None; no rhyme, embedding, account, or analytics API |
| Verification | 70/70 unit/data checks; green lint, TypeScript, evaluator, sound-benchmark, and semantic-index validation; 10/10 root Chromium production scenarios; 12/12 Pages scenarios with Chromium full plus Firefox/WebKit core loops; same-origin, semantic-failure, and worker-artifact compatibility guardrails |
| Evidence | Versioned provisional labelled-pool evaluator, retrieval diagnostics, sound/browser benchmark protocols, and manual privacy-safe research-session export; zero human review |

The generated pronunciation pack is 2,590,377 bytes (about 2.47 MiB). The semantic index contains 54,140 × 384 vectors and 35,470 bounded definitions: its 21,006,336-byte binary plus 3,386,621-byte manifest total 23.26 MiB raw. Including the six pinned model/tokenizer/config/vocabulary files, ONNX runtime, WASM, and versioned worker, the complete optional path is about 69.10 MiB raw. Its exact aggregate differs between root and Pages exports because the versioned worker embeds the deployment base path. Those are local asset bytes, not wire-transfer or memory totals. Sound starts first. The semantic module, worker, model, WASM, and index remain unfetched until the writer enables meaning, chooses Bridge, or raises the meaning mix; the explicit choice is remembered locally.

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

**Evidence:** the code, data, live network path, browser behaviour, and ranking outputs were audited independently. The public build is healthy and entirely same-origin. A cold/warm browser sample and a sound-search diagnostic established the first performance baselines. The audit also found and reproduced the inherited semantic-score fault described above.

**Decision:** call v0.1 a credible public alpha, not a validated product. Preserve the architecture and visual direction, fix correctness defects immediately, and make v0.2 an evidence milestone before expanding into voice or global graph work.

**Trade-off:** the next iteration will add less visible surface area than a voice or clustering demo, but it will tell us whether later sophistication is improving a writer's choices.

**Follow-up:** build the golden-set evaluator, repeatable performance harness, and local research export described in the [roadmap](./ROADMAP.md); decide the semantic loading policy before deliberately driving wider traffic.

## 10–11 August 2026 — Guardrails and evidence tooling before ranking claims

**Question:** how can the public alpha remain fast and trustworthy for sound-only writing while creating enough reproducible evidence to decide what deserves improvement next?

**Change:** v0.2.0 made semantics an explicit progressive enhancement. Sound search starts immediately; the semantic module, worker, model, and WASM load only after **Enable meaning**, Bridge, or a non-zero meaning mix. The writer's choice is remembered locally, loading can be cancelled, and a ready or failed semantic path can be disabled back to sound only. Semantic loading is deliberately shown as indeterminate: against the local benchmark server, Transformers.js 4.2's numeric progress callback made a metadata range request that the server answered with the complete 22.97 MB ONNX body before the real model fetch. Removing that callback restored one model transfer in the measured path without weakening the local-only boundary. The settings panel now provides explicit **Start research session**, **Export research session**, and **Clear & stop** controls. Capture exists only after Start and uses sessionStorage for the current page session. Its versioned JSON includes anchors, concepts, candidate actions, view/settings changes, and timings, while excluding the full draft, project title, and cursor positions; the app has no upload endpoint.

The release checks now exercise root and GitHub Pages production paths. Chromium covers the full semantic writing loop; Chromium, Firefox, and WebKit cover the sound-first keyboard loop. Each browser scenario audits runtime requests for unexpected origins. Lightweight accessibility assertions cover names, focus, focus order, landmark, and heading structure, and an injected semantic-worker failure must preserve useful sound results.

The evidence slice adds a versioned schema and 25-scenario provisional development set spanning Continue, Bridge, Pivot, multi-pin families, and a five-anchor workload. `npm run evaluate` compares the current phonetic scorer with a plain stressed-vowel/suffix baseline over the machine-assisted labelled development pool. `npm run benchmark:sound` records versioned Node initialization/search/memory observations, while `npm run benchmark:browser` records cold and repeat production readiness, worker-inclusive encoded response sizes, and available renderer heap. The report labels those byte observations as encoded bodies/headers rather than complete wire-transfer totals. Their JSON reports live under ignored `outputs/` paths so a local run does not become an unexplained repository claim.

**Evidence:** automated browser checks prove that a sound-only session requests zero semantic model/WASM assets, the local preference drives repeat startup, semantic failure leaves the sound loop usable, and all observed application requests remain same-origin. The evaluator and both benchmark commands produce revisioned, machine-readable reports; the evaluator and sound benchmark also have check-only validation paths for CI, where timing would be meaningless. The research export records insertion, undo, pin, traversal, map/list, engine, and timing events without recording the draft or sending a network request.

A fresh run of the 118-label development pool after the stress, depth, and Pivot corrections scored the current phonetic engine at `.940803` macro nDCG@3 and `.952482` macro nDCG@10; covered-only values were `.980003` and `.992169`. The documented suffix baseline scored `.935200` and `.946271` macro, with `.974166` and `.985699` covered-only. Current reciprocal rank was `.92` versus `.90`; both scorers had a `.027778` top-three high-impact false-positive rate (`2/72`). Current-minus-baseline deltas were therefore `+.005603`/`+.006211` macro nDCG, `+.005837`/`+.006470` covered-only nDCG, `+.02` reciprocal rank, and `0` false-positive-rate change. This unreviewed, machine-assisted, non-held-out pool has no confidence intervals and does not establish that either scorer is artistically better. The small lead remains well below the roadmap's `+.03` held-out nDCG@10 gate and is calibration plumbing, not a product-quality claim.

A fresh Chromium run against the v0.2.0 production export observed cold DOM, sound, meaning, and combined-result readiness at `657`, `2,371`, `13,379`, and `19,861 ms`. In the same browser context, a cached repeat observed `298`, `2,205`, `6,278`, and `9,898 ms`. The sound-only phase made zero semantic requests. Opting in transferred one `22,972,370`-byte ONNX body and `47,299,486` bytes of semantic model/runtime bodies in total; including the separately observed worker script puts the optional path at about `45.6 MiB`. All 24 cold and 17 repeat requests finished with no failure, while repeat semantic bodies came from cache. These are one-machine protocol observations, not portable latency or memory claims.

A 30-pass, three-warm-up v0.2 sound reference candidate on the 2-core/4-thread i7-7500U development laptop covered all available intent and pin-count strata. Engine indexing took `391.021 ms`; 180 query samples observed a `1026.13 ms` median, `3303.119 ms` p95, and `9107.142 ms` maximum. Post-run process RSS was `814.813 MiB` above the pre-load sample, measured without forced garbage collection and therefore not a peak or retained-allocation claim. The run mechanically satisfied that revision's benchmark manifest but materially missed the roadmap's search budgets and motivated the v0.3 retrieval work.

This is infrastructure evidence, not recommendation validation. The evaluation set is machine-assisted and provisional, has zero human reviewers and no held-out split, and reranks a phonetic labelled candidate pool rather than measuring full-vocabulary retrieval. Bridge-labelled cases exercise intent-aware phonetic ranking; they do not establish semantic Bridge quality. Benchmark output remains machine- and protocol-specific. No structured target-writer session has yet answered whether the suggestions improve writing.

**Decision:** mark M0 public-alpha guardrails as shipped and M1 evidence tooling as a shipped foundation, with human and held-out evidence still pending. Keep sound as the default usable instrument and semantics as an explicit local bandwidth choice. Keep the current graph as a stable star-shaped projection of one ranked neighbourhood; do not describe it as a global embedding graph, corpus cluster map, or candidate-to-candidate similarity graph.

**Debt introduced:** the provisional set needs independent reviewers, more balanced intent/category coverage, and a separately sourced frozen split; Bridge needs a semantic-quality study rather than phonetic intent fixtures alone. The benchmark protocols need controlled reference-device runs before budgets are enforced. The manual research file still requires a consenting writer to start capture, inspect the file, and deliberately share it outside the app. Persisted drafts and semantic preference remain in origin-scoped localStorage, while active research capture uses per-tab sessionStorage; on GitHub Pages, `/RhymeGraph` is not a separate storage boundary from other `sjmakin.github.io` pages for either API. Automated accessibility checks do not replace screen-reader, reduced-motion, 320 px/400%, or physical-device testing.

## 15 August 2026 — The neighbourhood needed better material, not more gloss

**Question:** why did a technically broad loose-rhyme engine still return dull results, barely respond to its controls, and become awkward to explore on a small monitor?

The product critique was specific: the result vocabulary did not feel useful enough for rap or music; several important loose and multisyllabic relationships were missing or mislabelled; semantics could only reorder whatever sound search had already found; and the projection consumed scarce screen space without making the different routes through a rhyme family obvious. Named UK rap references were used to expose vocabulary and interaction failures, not as text to copy or a style target. No lyrics were ingested, stored, embedded, or used to train an artist-imitation system.

### Change: vocabulary and phrases became transparent build inputs

The compact pack grew from 35,510 words / 39,175 pronunciations to **54,132 words / 59,783 pronunciations**, while retaining **8 explicit phrase fixtures**. SUBTLEX-US spoken-frequency counts now serve two narrow purposes: retain useful spoken forms and inflections that the old WordNet filter dropped, and supply a smoother everyday-utility signal than sense count. The build also contains labelled, auditable slang, UK, and reference additions for failure terms such as `dorchester`, `malbec`, `mayfair`, `moncler`, `shiraz`, `sonnyjim`, and `vuvuzela`. This is a coverage layer, not a UK pronunciation corpus, rap corpus, or claim about an artist's vocabulary.

At worker start, the engine also composes **151 authored ordinary performance-phrase building blocks** from existing word pronunciations. The list covers transparent forms such as travel, street, money, work, place, and conversational combinations; it was written for the project rather than extracted from lyrics or an n-gram source. These phrases make cross-word exploration visible without asserting corpus frequency or exhaustive grammatical coverage.

### Change: long rhyme chains gained explicit coverage

Pair scoring now evaluates variable suffix windows from one to six syllables. Coverage measures how much salient suffix material each chosen window preserves; balance measures whether the compared windows have compatible syllable depth. Phrase-involved comparisons require stronger coverage than ordinary word suffix rhyme, so an exact last word cannot beat a coherent cross-boundary chain by itself. The depth reward is stress-gated and consumes only remaining score headroom, a full-rhyme label requires stress agreement of at least `.70`, and inverted word stress can no longer saturate into a full rhyme; its explanation explicitly says **emphasis differs**. Labels remain explanations derived from component scores rather than mutually exclusive ranking classes.

### Change: Reach became a retrieval control

The worker no longer performs a default exhaustive scan. A multi-channel index retrieves candidates through exact/coarse vowel sequences, exact/coarse three-vowel outer sketches, vowel families, codas, exact consonant suffixes, coarse voicing-aware consonant families, and stress patterns, retains the small authored phrase bank, and explicitly unions semantic terms. Exact phonetic comparison still reranks the bounded pool. Pivot has an inherently non-exact target band even at minimum Reach; Reach moves that band farther instead of changing Pivot from an accidental Continue clone.

The renamed Reach states—**Close**, **Open**, **Wide**, and **Far out**—now change shortlist breadth, minimum sound gates, the intended sound-distance target, rhyme-family quotas, function-word pile-up limits, and reserved phrase slots. Continue, Bridge, and Pivot transform the same evidence differently. The control therefore changes what can enter the result set and what is rewarded; it no longer merely repaints a near-identical top list.

This first index has real recall debt. A focused difficult-case audit for `orange` in Pivot mode recovered **8 of the exhaustive top 25 identities**. Mean score regret was about **0.0031**, which means many replacements were numerically close, but identity recall still matters: a specific useful option cannot be recovered by a near-tied alternative if the writer wanted that word. Final indexed timing and a representative frozen-query recall report are pending. The index is a v0.3 prototype, not a cleared performance or quality gate.

### Change: meaning can introduce a word rather than only promote it

The semantic build now creates an int8 vector for every compact word plus the explicit pack fixtures: 54,140 rows of 384 dimensions. Documents use the spelling, POS, primary WordNet gloss material, and a bounded synonym list; 35,470 rows (65.5%) retain a bounded primary definition. At runtime MiniLM embeds only the writer's query, scans the local vector index, and returns independent semantic neighbours. A CDF fitted to unrelated corpus pairs produces an available percentile-like score; the current UI and ranker use the fixed `fusionScore = (cosine - null mean) / (4 × null SD)`, clamped to `[0, 1]`. Neither transform depends on the current batch, so the leader of a weak set is no longer automatically stretched to 100.

Semantic hits are unioned with the indexed phonetic shortlist and then receive exact sound scoring before late fusion. A meaning neighbour outside the original 72 sound candidates can therefore enter Bridge or a meaning-led search, while a configurable phonetic floor keeps the result attached to the requested sound. The binary is 21,006,336 bytes with SHA-256 `2e48ce37bd70f1b1b4805a915214071ec16fe81a157f861c3621f9526b789d5e`; the 3,386,621-byte manifest hash is `168d0c07e41daefecdc4f06667c3b349d8474948d890a92bceaee2e45174cecf`. CI checks six exact model/tokenizer/config/vocabulary files against asset-set SHA-256 `551f651982a81f63580c48b0fe704b66fab2be32bfd562123ee3bc1636273cd8`, while the browser verifies the semantic binary through WebCrypto SHA-256. `semantic:index:check` observed a 41.53 ms median full scan in one local Node run, with parse/load diagnostics around 96 ms. All model, index, and inference assets remain local, lazy, and optional; failure returns to sound.

One headless Chromium 151 sample on the i7-7500U development laptop used a dirty local static export. Cold DOM/sound/meaning/combined readiness was `253.07/2218.10/4162.42/5155.22 ms`; same-context repeat readiness was `81.44/3243.22/2218.32/3753.41 ms`. Playwright finished 24/24 cold requests (10/10 semantic) and 17/17 repeat requests (3/3 semantic), with zero failures or in-flight work. It observed `71,692,443` semantic encoded-response-body bytes and `74,904,430` total encoded-response-body bytes cold; repeat semantic and total encoded response bodies were both `21,006,336` bytes. These observations are not wire-transfer or memory totals, and one headless sample is not p75. Physical-mobile performance remains unmeasured.

MiniLM remains a baseline. Primary gloss documents reduce isolated-word ambiguity but do not solve lyric semantics, cultural context, polysemy, dialect, or taste. Definitions explain a local indexed sense when present; they are not proof that the semantic edge is useful in a bar.

### Change: dialect support started with a deliberately small transform

The studio now persists a choice between **General American** and **UK non-rhotic · beta**. The beta scoring transform drops post-vocalic `R` when no following vowel licenses linking `R`, and maps only unstressed rhotic `ER0` to schwa/`AH0`. Stressed `ER` remains distinct so NURSE is not collapsed into STRUT—for example, `bird` must not become `bud`. It does not invent a complete British vowel system, word-specific regional pronunciations, or a universal UK accent. CMU remains the source basis, SUBTLEX is US, and the authored UK tags merely record useful coverage. Human dialect review is required before the beta can become a dialect pack.

### Change: the explorer leads with families and tells the truth about edges

Families is now the default view, separating locked endings, vowel links, consonant links, phrase/mosaic options, and meaning routes. Candidates may appear in more than one channel because the underlying evidence overlaps. **Focus** gives the explorer most of the screen on smaller monitors; candidate details open in a dismissible drawer; Map and List remain synchronized alternatives. Filters operate over the complete 96-result sound pool or 120-result hybrid pool and backfill the visible set instead of discarding candidates from an already short display.

The optional map now draws actual candidate-to-candidate phonetic k-nearest-neighbour edges from pronunciation comparisons, with a deterministic bounded layout and collision pass. It is still local to the current result set. It is not a global embedding projection, a k-means corpus map, or a pairwise semantic graph; independent query-to-candidate semantic scores do not establish how two candidates relate to each other.

### Evidence and decision

Automated tests now cover expanded pack metadata, audited reference/UK terms, phrase composition and word boundaries, loose/full-label, inverted-stress, Pivot, headroom, phrase-coverage, and mixed-OOV regressions, long-window scoring, reach-sensitive ranking/diversity, indexed shortlist structure, semantic union/calibration, and deterministic graph edges/layout. The final pass is 70/70 unit/data checks, with whole-tree lint, TypeScript, evaluator, sound-benchmark, and semantic-index validation green, alongside 10/10 root Chromium production scenarios and 12/12 `/RhymeGraph` Pages production scenarios, including the full Chromium path and Firefox/WebKit core loops. Browser checks cover family-first navigation, Focus/drawer behaviour, filters, named controls, dialect persistence, stale hybrid isolation, and the local-only loading boundary. Content-revisioned lexicon/index URLs, versioned self-contained v3 worker entrypoints, refreshed unversioned aliases, and retention of the live prior Pages chunk `workers/chunks/public-path-B_7tJUiL.js` protect the current cache window; two automated artifact-regression cases cover that compatibility boundary. These establish mechanics and failure boundaries only.

There are still **zero human recommendation reviewers and zero target-writer sessions**. The change is therefore best described as a deeper, more inspectable v0.3 recommendation-content prototype. Keep the family-first direction, semantic union, truthful local graph, and material controls; do not claim that they are “good enough for” any named artist until independent writers judge and retain the results.

**Debt introduced:** improve indexed identity recall without returning to a default exhaustive scan; complete physical-mobile semantic, robust memory, and multi-run performance audits; review the UK beta with relevant speakers; judge the 151 phrases for usefulness and grammar; evaluate definitions and MiniLM against lyric-context queries; compare Families/Map/List with writers on physical small screens; and bump worker plus asset namespaces together on every future coupled worker/data/model change.

## What this prototype proved

1. A functional, explainable indexed phonetic search can run over more than 54,000 words entirely in-browser.
2. A compact local embedding model and int8 vocabulary index can introduce semantic neighbours without a third-party service.
3. Sound-only fallback is a viable product state rather than a fatal error.
4. Multi-pin, Continue/Bridge/Pivot, family exploration, and local graph traversal form a mechanically coherent writing interaction.
5. The whole application fits a static-hosting and local-first privacy model.
6. The visual system is strong enough to make a complex engine approachable.

## What it has not proved

1. That target writers prefer its suggestions to a conventional rhyme dictionary.
2. That the current ranking is consistently useful across a representative set of anchors and lyric contexts.
3. That graph traversal causes more useful discoveries than the ranked list alone.
4. That the vocabulary and pronunciation assumptions cover real rap writing, regional speech, and code-switching well enough.
5. That the UK non-rhotic beta represents any particular speaker or region accurately.
6. That the indexed shortlist reliably preserves the specific results writers value, especially in Pivot mode.
7. That the semantic payload and inference path are acceptable on low-end phones and slower networks.
8. That the authored phrase bank is grammatically and artistically useful in real writing.
9. That speech timing improves recommendations enough to justify the complexity of STT/TTS.

Those are the next questions. Adding more surface area before answering them would make the product larger without making the core claim more certain.

## Decision record

| Decision | Reason | Revisit when |
| --- | --- | --- |
| Local-first, static runtime | Privacy, self-hostability, and no service dependency | A proven feature strictly requires a server |
| CMU-based `en-US` source plus selectable UK non-rhotic beta | Explore broad rhoticity effects without pretending to ship a complete UK accent | Reviewed, word-specific dialect data can replace/refine the beta |
| Separate phonetic and semantic workers | Failure isolation and responsive UI | Profiling shows worker overhead dominates |
| Full-vocabulary semantic union before late fusion | Meaning can introduce candidates while exact sound scoring stays explainable | Human semantic-retrieval evidence supports another design |
| Quantized MiniLM baseline | Small enough to establish local semantic feasibility | A measured alternative wins quality/latency/size |
| No guessed pronunciation for unknown words | Avoid confident but misleading phonetic claims | An evaluated, dialect-aware G2P path exists |
| Eight fixtures plus 151 authored ordinary phrase blocks | Broader mosaic discovery without dubious corpus or lyric rights | Reviewed user-local or redistributable phrase data is available |
| Family board default; local phonetic kNN as optional map | Families are legible on small screens and every map edge has real pairwise evidence | A simpler view wins, or evaluated pairwise semantics adds value |
| Semantic stack loads on demand | Sound-first speed and an explicit optional local bandwidth choice | Final payload evidence supports a smaller model or another transparent policy |
| Explicit, session-scoped local research export only | Supports formative sessions without passive telemetry, persistent capture, or draft capture | A separate, explicit submission study is approved |
| Voice deferred | Typed recommendation quality is the prerequisite | The typed loop clears its validation gate |
| GitHub Pages deployment | Simple static hosting fits the architecture | The owner chooses another publishing arrangement |

## Open decisions

These have intentionally not been guessed:

- the licence for RhymeGraph's own source code;
- default handling of explicit vocabulary;
- which speakers and region should review and mature the UK non-rhotic beta;
- whether any future, separately consented research submission path should exist; v0.3.0 still only downloads a manual local file;
- future publishing, sharing, custom-domain, or account behaviour.

## Format for future entries

Each substantial iteration should add a dated entry containing:

1. **Question** — what uncertainty were we trying to reduce?
2. **Change** — what was built or tested?
3. **Evidence** — benchmark, evaluation set, user observation, or failure report.
4. **Decision** — keep, revise, remove, or defer.
5. **Debt introduced** — shortcuts and their explicit trigger for repayment.
