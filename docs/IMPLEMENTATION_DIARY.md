# RhymeGraph implementation diary

This is a record of product and engineering decisions, the evidence behind them, and the things the prototype has not proved. It is deliberately not a changelog: commits say what changed; this diary says why. The first entry is a retrospective reconstructed from the 3–4 August build session, the resulting code, and commits `07d184a` and `aea4ca6`.

## Current snapshot

**Date:** 4 August 2026  
**Status:** public vertical slice, deployed and independently usable  
**Live build:** [sjmakin.github.io/RhymeGraph](https://sjmakin.github.io/RhymeGraph/)  
**Source:** [github.com/SJMakin/RhymeGraph](https://github.com/SJMakin/RhymeGraph)

| Area | Current state |
| --- | --- |
| Product | A writing workspace with graph and ranked-list views |
| Sound retrieval | Stress-aware phonetic search in a dedicated browser worker |
| Meaning | Local `all-MiniLM-L6-v2` inference in a second browser worker |
| Vocabulary | 35,510 General American entries, 39,175 pronunciations, and 8 authored phrase fixtures |
| Persistence | Browser-local draft, title, anchor, pins, and traversal breadcrumbs |
| Hosting | Static Next.js export on GitHub Pages at `/RhymeGraph/` |
| Runtime services | None; no rhyme, embedding, account, or analytics API |
| Verification | 18 engine/data tests and 4 end-to-end browser scenarios |

The generated lexicon is about 1.43 MiB. The quantized ONNX model itself is about 21.9 MiB; model, tokenizer, ONNX runtime, and WASM together make the progressive semantic path roughly 45.8 MiB uncompressed, or about 47.3 MiB with the lexicon. It currently starts automatically after the sound engine. The complete static export is about 50.2 MiB.

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

A post-launch Node diagnostic over 24 representative cases measured engine initialization at 371 ms and about 33.6 MiB additional heap; searches had a 291 ms median, 859 ms p95, and a 1,793 ms maximum for a five-pin case. That materially misses the specification's aspirational sub-100 ms p95. The diagnostic now needs to become a versioned benchmark rather than remain a one-off audit.

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

The current semantic pass embeds the query and up to 72 phonetic candidates, computes cosine similarity, and reranks those candidates. It does **not** currently ship a precomputed embedding for every dictionary entry, sense, or gloss. Princeton WordNet is used only during the lexicon build as a lemma, part-of-speech, and sense-count source.

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
- up to five pinned family anchors;
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
| Voice deferred | Typed recommendation quality is the prerequisite | The typed loop clears its validation gate |
| GitHub Pages deployment | Simple static hosting fits the architecture | The owner chooses another publishing arrangement |

## Open decisions

These have intentionally not been guessed:

- the licence for RhymeGraph's own source code;
- default handling of explicit vocabulary;
- which dialect or regional pack should follow `en-US`;
- whether semantic loading remains automatic or becomes an explicit bandwidth choice;
- whether any opt-in research data should ever leave the browser;
- future publishing, sharing, custom-domain, or account behaviour.

## Format for future entries

Each substantial iteration should add a dated entry containing:

1. **Question** — what uncertainty were we trying to reduce?
2. **Change** — what was built or tested?
3. **Evidence** — benchmark, evaluation set, user observation, or failure report.
4. **Decision** — keep, revise, remove, or defer.
5. **Debt introduced** — shortcuts and their explicit trigger for repayment.
