# RhymeGraph

RhymeGraph v0.3.0 is a local-first writing instrument for exploring rhyme as a neighbourhood rather than a lookup table. It combines stress-aware phonetic matching, assonance, consonance, slant and multisyllabic rhyme, cross-word phrases, and optional semantic direction in a family-first explorer.

Nothing typed into the studio is sent to a rhyme, embedding, analytics, or account service. Pronunciation search runs in a browser worker. Meaning uses a locally hosted MiniLM model and a local semantic index, both fetched only after an explicit meaning action; a sound-only session requests neither the model, its WASM runtime, nor the semantic index.

**[Open the live studio](https://sjmakin.github.io/RhymeGraph/)** (the deployed version follows successful pushes to `main`)

![The RhymeGraph writing studio](./docs/rhymegraph-studio.png)

## Run it

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

The repository is a static Next.js application. `npm run build` creates the export in `out/`, and `npm start` serves that export locally.

## GitHub Pages

The Pages workflow builds and browser-tests the app at its real repository subpath before publishing it. In the repository settings, choose **Pages → Source → GitHub Actions** once; later pushes to `main` deploy automatically.

```bash
npm run test:pages  # exercise the /RhymeGraph production path locally
```

For a manual post-deploy audit, set `PLAYWRIGHT_BASE_URL=https://sjmakin.github.io` and `PLAYWRIGHT_BASE_PATH=/RhymeGraph`, then run `npm run test:browser`. Supplying the external URL disables the local development server; tests run against the live deployment.

## Useful commands

```bash
npm run data:build             # rebuild the compact pronunciation lexicon
npm run semantic:index         # rebuild the optional local semantic index
npm run semantic:index:check   # validate the checked-in semantic artefacts
npm run workers:build
npm test                       # engine, data, evidence, graph, and session checks
npm run test:site              # production build plus browser checks
npm run test:pages             # Pages-subpath build plus browser checks
npm run evaluate
npm run benchmark:sound
npm run benchmark:browser
npm run lint
```

Evaluation and benchmark reports are written under the ignored `outputs/` directory. They include dataset/runtime revisions and environment context; treat them as local evidence, not portable performance claims.

## What changed in v0.3

- The compact pack now contains **54,132 words**, **59,783 pronunciations**, and **8 explicit phrase fixtures**. CMUdict supplies the US pronunciation basis, WordNet supplies lexical metadata, and SUBTLEX-US supplies spoken-frequency coverage and utility. Audited UK and reference additions include lyric-relevant spoken forms, places, products, and names; they are a small transparent layer, not a style corpus.
- At worker start, RhymeGraph composes **151 authored ordinary performance-phrase building blocks** from checked-in word pronunciations. They are not scraped lyrics, copied artist text, or an n-gram corpus, and they do not claim exhaustive phrase coverage.
- Pair comparison tests variable **one- to six-syllable suffix windows**. Coverage and window balance stop a short matching ending from masquerading as a complete multisyllabic or mosaic rhyme. Depth rewards are stress-gated and consume only remaining score headroom, a full-rhyme label requires stress agreement of at least `.70`, and an inverted word-stress pattern is explained as **emphasis differs** rather than saturating the score.
- Sound retrieval uses bounded, multi-channel posting lists for exact/coarse vowel sequences, exact/coarse three-vowel outer sketches, codas, exact consonant suffixes, coarse voicing-aware consonant families, stress, phrases, and exact semantic-union terms. Reach changes shortlist breadth, phonetic gates, ranking targets, family diversity, common-word pile-up, and phrase quotas; it is not a cosmetic reshuffle. Pivot starts in a neighbouring—not exact—sound band even at minimum Reach, then moves farther as Reach rises.
- The optional semantic path embeds the query once, searches a full-vocabulary local int8 index built from MiniLM representations of primary WordNet gloss/POS documents, and unions those hits with the phonetic shortlist before late fusion. The index exposes both a corpus-CDF percentile and a fixed strength derived from the same unrelated-pair background; the current UI and ranker use the fixed strength, never candidate-batch min/max normalization. Definitions are shown when the local index has one. Remote model fallback remains disabled.
- The explorer opens on sound families rather than a cramped projection. **Focus** gives the explorer more room on small monitors, candidate details use a dismissible drawer, and filters backfill across the 96-result sound pool or 120-result hybrid pool instead of filtering an already truncated list.
- The optional map is a deterministic local candidate-to-candidate **phonetic k-nearest-neighbour graph**. Its edges come from actual pronunciation comparisons; it is not a global embedding map, a k-means corpus projection, or a claim that query-level semantic scores imply pairwise semantic similarity.
- **General American** and a conservative **UK non-rhotic · beta** performance profile are selectable and persisted locally. The beta drops unlinked post-vocalic `R` and maps only unstressed rhotic `ER0` to schwa/`AH0`; stressed `ER` remains distinct so NURSE is not collapsed into STRUT. The source lexicon remains CMU-based US English and the profile is not a complete British accent pack.

## Interaction

- Select a word or known-word phrase in the draft, or place the caret inside a word, to make it the anchor.
- Explore the default family board, the local map, or the ranked list. Click a candidate for details; double-click a map node or press `E` to traverse from it.
- Press `P` to pin the selected word, `I` to insert it, and `Ctrl/Cmd+Z` to undo the last insertion.
- Use up to four pins alongside the active anchor—five total—to describe a shared rhyme family.
- Use **Sound only / Sound-led / Balanced / Meaning-led** and **Close / Open / Wide / Far out** controls. Continue, Bridge, and Pivot also change retrieval and ranking behaviour.
- Choose **Start research session** to begin explicit capture for the current page session. **Export research session** downloads a versioned JSON record of anchors, concepts, candidate actions, settings, and timings; **Clear & stop** removes it. Capture excludes the full draft, project title, and cursor positions and never uploads anything.

## Evidence and limits

- The existing 25-scenario, 118-label development set remains provisional and machine-assisted. It has **zero human reviewers**, no held-out split, no independent judgements, and no target-writer validation. It is evaluator plumbing, not evidence that the recommendations are artistically good.
- A focused v0.3 indexed-retrieval audit found that the difficult `orange` Pivot query preserved **8 of the exhaustive top 25 identities**, with approximately **0.0031 mean score regret**. That combination is useful diagnostic evidence: the shortlist often finds similarly scored alternatives, but its exact Pivot recall is not yet acceptable. v0.3 indexed retrieval is a prototype with recall debt, not a cleared performance/quality gate.
- The semantic index contains **54,140 × 384** int8 vectors and **35,470 definitions** (65.5%). Its 21,006,336-byte binary and 3,386,621-byte manifest form a 23.26 MiB raw index payload. The complete optional path is **about 69.10 MiB raw**; its exact file total differs between root and Pages exports because the versioned worker embeds the deployment base path. CI verifies the six pinned model/tokenizer/config/vocabulary files against asset-set SHA-256 `551f6519…6273cd8`. These are asset bytes, not observed wire transfer or memory.
- One headless Chromium 151 sample on the i7-7500U development laptop, against a dirty local static export, observed cold DOM/sound/meaning/combined readiness at **253.07 / 2,218.10 / 4,162.42 / 5,155.22 ms** and same-context repeat readiness at **81.44 / 3,243.22 / 2,218.32 / 3,753.41 ms**. Playwright finished 24/24 cold requests (10/10 semantic) and 17/17 repeat requests (3/3 semantic), with no failures or in-flight requests. It observed **71,692,443 semantic encoded-body bytes** and **74,904,430 total encoded-body bytes** cold; repeat semantic and total encoded bodies were both **21,006,336 bytes**. These are encoded response bodies, not wire-transfer or memory totals; one sample is not p75. Physical-mobile performance and human usefulness remain unmeasured.
- The final automated pass is **70/70 unit/data checks**, plus green lint, TypeScript, evaluator validation, sound-benchmark validation, and semantic-index validation; **10/10 root Chromium production scenarios** and **12/12 `/RhymeGraph` Pages production scenarios** cover the full Chromium path plus Firefox/WebKit core loops. Semantic binary bytes are WebCrypto SHA-256 checked in-browser; lexicon/index requests are content-revisioned; v3 worker entrypoints are versioned and self-contained. The live prior Pages chunk, `workers/chunks/public-path-B_7tJUiL.js`, remains available across the cache window and two automated artifact-regression cases check that compatibility boundary. Future coupled worker/data/model changes must bump the worker and asset namespace together.
- SUBTLEX-US improves commonness and spoken-form coverage; it does not make the pronunciation source British or constitute a UK rap corpus. The UK non-rhotic profile is deliberately conservative and needs dialect review.
- The 151 performance phrases are authored building blocks, not evidence of real lyric frequency or grammatical fit in every context. Unknown words still receive no guessed pronunciation, and a multi-anchor family returns no results if any requested anchor is unresolved rather than silently dropping it.
- There is no copied lyric dataset, artist imitation model, or artist-style generation. Examples used to audit coverage are vocabulary prompts, not a training corpus.
- On GitHub Pages, persisted drafts, dialect, and meaning preferences use origin-scoped localStorage, while an active research session uses per-tab sessionStorage. Neither API is isolated by the `/RhymeGraph` path from other pages at the same `sjmakin.github.io` origin.
- The lyric field disables browser spellcheck so the app does not invite cloud-assisted correction of unpublished text. Browser extensions, keyboards, and input methods remain outside the application's network boundary.
- Assets are static and same-origin, but no service worker is shipped; offline-after-first-load is not guaranteed.

See the [product and technical specification](./SPEC.md), [implementation status](./docs/STATUS.md), [implementation diary](./docs/IMPLEMENTATION_DIARY.md), and [evidence-led roadmap](./docs/ROADMAP.md). Data and model attribution is recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
