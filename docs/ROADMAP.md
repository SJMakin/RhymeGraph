# RhymeGraph roadmap

This roadmap is ordered by uncertainty, not by feature excitement. It is a proposal for review, not a publishing schedule.

## North-star question

> Does RhymeGraph help a writer keep or reach words they would not have found quickly with an ordinary rhyme list?

The strongest signal is not time spent admiring a graph. It is a writer inserting, pinning, or traversing through a result and continuing to write.

## Recommended sequence

### M0 — Public-alpha guardrails — shipped in v0.2.0

**Goal:** establish a safe observation baseline.

Delivered:

- sound works without enabling or downloading meaning;
- the semantic model, runtime, and worker are local/same-origin, lazy, cancellable, and failure-isolated;
- root and `/RhymeGraph` exports are browser-tested;
- Chromium covers the full loop and Firefox/WebKit cover the sound-first keyboard loop;
- lightweight accessibility, same-origin request, and semantic-failure checks protect the core path;
- research capture is manual, session-scoped, local, and excludes the full draft.

**Result:** a useful guardrail foundation, not full WCAG, screen-reader, device, storage-failure, or offline proof.

### M1 — Evidence harness — tooling shipped; human evidence still absent

**Goal:** make recommendation changes measurable.

Delivered in v0.2.0:

- a versioned scenario format for anchor, context, pins, intent, and dialect;
- 25 provisional machine-assisted scenarios and 118 labels across Continue, Bridge, Pivot, multi-pin, and five-anchor work;
- a documented stressed-vowel/suffix baseline and deterministic comparison report;
- Node sound and browser-runtime benchmark protocols;
- explicit Start / Export / Clear & stop research controls whose local JSON excludes the draft, project title, and cursor positions.

The set has **zero human reviewers**, no independently sourced held-out split, and no target-writer sessions. Bridge-labelled cases in the original harness do not establish semantic Bridge quality. The tooling can expose regressions and hypotheses; it cannot establish artistic usefulness.

Still required:

- grow toward 150–200 independently judged scenarios across full, slant, assonant, consonant, multisyllabic, mosaic, Pivot, semantic Bridge, multi-pin, slang, and dialect cases;
- source and freeze a separate held-out split of at least 50 scenarios before tuning against it;
- collect two independent grades per candidate where possible and report agreement;
- run controlled, revisioned benchmarks on named reference environments;
- conduct five formative and at least eight observed target-writer sessions.

For the ranking gate, use `0 = unrelated`, `1 = usable`, and `2 = keep-worthy`; calculate nDCG on frozen scenario IDs; bootstrap whole scenarios; collect at least 100 blinded head-to-head judgements; and report a category only with at least 20 scenarios. A high-impact false positive is a top-three result both reviewers mark unrelated.

**Gate:** require at least +.03 held-out nDCG@10 with a positive bootstrap interval, at least 55% blinded pairwise wins, no more than 5% high-impact false positives, and no eligible slice regression beyond .03. Advance observed alpha only when at least 80% of eight or more writers complete select → explore → insert without coaching within two minutes and at least half retain an insertion after ten minutes.

### M2 — Retrieval, vocabulary, and meaning — v0.3 prototype implemented; gates open

**Goal:** improve which possibilities enter the pool before adding a more opaque ranker.

Implemented in the v0.3 candidate:

- a 54,132-word / 59,783-pronunciation compact pack using CMUdict, WordNet metadata, and SUBTLEX-US spoken-frequency coverage/utility;
- a transparent authored slang/reference/UK layer covering audited failure vocabulary without scraping lyrics or constructing an artist corpus;
- variable one- to six-syllable suffix-window alignment with explicit coverage and balance, a stress-gated depth reward restricted to remaining score headroom, a `.70` stress floor for full-rhyme labels, and an explicit **emphasis differs** explanation for inverted word stress;
- a multi-channel phonetic index over exact/coarse vowel suffixes, exact/coarse three-vowel outer sketches, codas, exact consonant suffixes, coarse voicing-aware consonant families, and stress, followed by exact reranking of a bounded shortlist;
- a Reach control that materially changes shortlist breadth, phonetic gates, intended sound distance, diversity, function-word caps, and phrase quotas, with Pivot inherently starting outside the exact-rhyme band;
- 151 authored ordinary performance-phrase building blocks composed from word pronunciations at runtime, alongside 8 explicit pack fixtures;
- an optional full-vocabulary int8 semantic index built from MiniLM embeddings of primary WordNet gloss/POS documents;
- query-only semantic inference, an available corpus-CDF percentile, a fixed corpus-scaled fusion strength used by the current UI and ranker, semantic/phonetic candidate union, and late fusion rather than candidate-batch min/max reranking;
- locally available primary definitions for semantic hits where WordNet supplies one;
- a selectable, persisted UK non-rhotic beta that drops unlinked post-vocalic `R`, maps only unstressed `ER0` to schwa/`AH0`, and preserves stressed NURSE `ER` versus STRUT `AH`, while retaining an honestly labelled CMU-based US source lexicon.

The phonetic index is a prototype, not a completed recall result. A focused `orange` Pivot diagnostic recovered **8/25** exhaustive top-result identities, with approximately **0.0031 mean score regret**. It usually found similarly scored alternatives, but an artistically specific result can still disappear. The exact final indexed-search timing is pending. The completed semantic index uses a 21,006,336-byte binary plus 3,386,621-byte manifest, and the complete optional path is about 69.10 MiB raw. Its exact file total varies between root and Pages exports because the versioned worker embeds the deployment base path. One local Node checker run scanned the vectors in a 41.53 ms median.

One headless Chromium 151/i7-7500U sample against a dirty local static export observed cold DOM/sound/meaning/combined readiness at `253.07/2218.10/4162.42/5155.22 ms` and repeat readiness at `81.44/3243.22/2218.32/3753.41 ms`. Playwright finished 24/24 cold requests (10/10 semantic) and 17/17 repeat requests (3/3 semantic), with no failures or in-flight work. Cold semantic and total encoded response bodies were `71,692,443` and `74,904,430` bytes; repeat semantic and total encoded bodies were both `21,006,336` bytes. This is one Playwright encoded-body observation, not wire transfer, memory, p75, physical-mobile evidence, or human usefulness.

Still required:

- diagnose and improve difficult Pivot/multisyllabic shortlist recall without returning to a default full scan;
- run recall comparisons across the frozen query set and separately report identity recovery, score regret, intent, syllable count, and anchor count;
- measure OOV coverage and review pronunciations with intended writers and dialect reviewers;
- test whether SUBTLEX utility improves usefulness rather than merely favouring common words;
- independently evaluate semantic recall, calibrated score interpretation, definitions, and phonetic-floor trade-offs;
- add transparent user-local phrase/pronunciation entries before adding a large external phrase source;
- treat the UK beta as a scoring experiment until audited word-specific pronunciations and reviewers exist.

**Gate:** indexed candidates should recover at least 99% of exhaustive top-25 membership slots on frozen sound queries before exact reranking, with sound-search p95 below 100 ms on the named desktop reference and 500 ms at 4× CPU throttle; five-anchor desktop p95 should remain below 300 ms. For Bridge, require at least +.05 nDCG@10 over sound-only generation, useful recall@25 of 85%, and semantic-badge precision of 80%. Report vocabulary/dialect coverage by category, not one aggregate.

### M3 — Explorer v2 — v0.3 interaction prototype implemented; utility unproved

**Goal:** make varied results legible and traversable on ordinary and small monitors.

Implemented in the v0.3 candidate:

- a default Families view with locked-ending, vowel, consonant, phrase/mosaic, and meaning channels;
- synchronized Families, Map, and List views;
- Focus mode to give exploration the screen and a dismissible candidate-details drawer;
- named sound/meaning and Reach states rather than unexplained percentages alone;
- filters that backfill from 96 sound candidates or 120 hybrid candidates instead of filtering a prematurely truncated visible list;
- an optional deterministic local graph with sparse candidate-to-candidate phonetic k-nearest-neighbour edges backed by actual pronunciation comparison and collision-aware placement.

The map is not a global embedding projection, a k-means corpus map, or a semantic graph. Independent query-to-candidate semantic scores cannot justify candidate-to-candidate semantic edges. A later experiment may compute pairwise local semantic relationships, but only if it remains explainable and beats Families/List in writing sessions.

**Gate:** run a counterbalanced crossover with at least eight writers completing four tasks per view. The explorer must make discovery of a useful second family at least 20% faster or improve retained insertion by at least 15 percentage points with a writer-level bootstrap interval above zero, while median time to ordinary insertion remains within 10% of the best simpler view. If the map only looks convincing, do not make it the default.

### M4 — Product hardening

**Goal:** make repeat use dependable across browsers, devices, storage states, and network conditions.

Build and verify:

- final sound-only and optional-semantic payload/readiness budgets on representative desktop and mobile hardware;
- durable cache versioning and an offline-after-first-load PWA experiment;
- missing/corrupt lexicon, semantic index, model, WASM, worker, and storage failure paths;
- Firefox, Safari/WebKit, Chromium, reduced-motion, keyboard-only, and screen-reader coverage;
- WCAG 2.2 AA contrast, focus, and 320 CSS px/400% reflow;
- user-controlled import/export of drafts, phrases, and pronunciation overrides;
- release/data/model metadata visible in diagnostics.

The v0.3 hardening pass content-revisions lexicon/index requests, verifies the semantic binary with WebCrypto SHA-256 in the browser, and publishes versioned self-contained worker entrypoints while retaining the live prior Pages chunk `workers/chunks/public-path-B_7tJUiL.js` across the cache window. An automated artifact regression protects that compatibility boundary. Future coupled worker/data/model changes must bump the worker and asset namespace together rather than relying on an unversioned cache alias.

GitHub Pages remains suitable while the product is static. Its localStorage and sessionStorage are scoped to the whole `sjmakin.github.io` origin, not isolated by `/RhymeGraph`; that limitation must remain visible.

**Gate:** zero serious/critical automated accessibility findings; keyboard and screen-reader completion; understandable reduced-motion behaviour; the core loop on current Chromium, Firefox, WebKit, and one named physical mid-range Android reference. First phonetic results should reach p75 ≤3 seconds cold/≤1 second warm and indexed rerank p95 ≤100 ms after initialization; warm WASM semantic query should reach p95 ≤1 second. Set a memory budget only from whole-process measurements. Claim offline use only after online → offline → update testing proves that mixed asset versions cannot occur.

### M5 — Performed cadence research

**Goal:** learn whether timing improves recommendations before building a voice product.

Start narrowly and locally:

- record a known line with explicit microphone consent;
- align known words to timing rather than asking a model to invent a transcript;
- extract onset, duration, pause, and emphasis features;
- compare cadence-aware replacement ranking with the text-stress baseline;
- use browser/system TTS only as an audition aid and label voice variability.

Only then evaluate a small local STT model for freestyle capture. A remote speech API would change the privacy promise and is not an assumed fallback.

**Gate:** at least 55% wins over the text-stress baseline across 100 blinded paired judgements, with a writer-level bootstrap interval above zero and no eligible slice regressing beyond .03 nDCG@10. Otherwise keep cadence as research.

### M6 — Optional knowledge layers

Etymology, lexical relations, dialect provenance, and word-history links could enrich traversal. Add them as independently versioned local packs only after the core writing loop proves retention. Each needs licensing, payload, ranking-separation, and visual-noise audits.

## Now / next / later

| Now | Next | Later |
| --- | --- | --- |
| Finish physical-mobile semantic, robust-memory, and multi-run production benchmark audits | Improve indexed recall, especially difficult Pivot/multisyllabic cases | Known-text cadence spike |
| Keep root/Pages/cross-browser/local-only gates green | Independently review and broaden the provisional set | Local STT feasibility |
| Verify semantic union quality and failure isolation | Source and freeze the held-out split | TTS audition mode |
| Run five formative writer sessions using local exports | Review the UK beta and word-specific pronunciations | Etymology and optional knowledge layers |
| Decide project licence and explicit-vocabulary policy | User-local phrases/pronunciations and import/export | Accounts, sharing, or publishing only if separately chosen |
| Measure Families/Map/List on small monitors and physical devices | Broader accessibility/device hardening | Global corpus graph only if local exploration proves useful |

## Delivered implementation slices

**M0 — guardrails**, shipped in v0.2.0:

1. Root and Pages-subpath exports are tested.
2. Cross-browser sound-loop, keyboard/accessibility, same-origin, and semantic-failure checks protect the core workflow.
3. Sound-first operation requests no semantic stack until an explicit meaning action.
4. Research capture is explicit, local, session-scoped, and manually exported.

**M1 — evidence tooling foundation**, shipped in v0.2.0:

1. A provisional development set and documented baseline exercise the evaluator.
2. Sound and browser benchmark protocols record revision/environment context.
3. Human review, held-out evidence, controlled benchmark runs, and writer sessions remain undone.

**M2/M3 — content and exploration prototype**, implemented for v0.3.0:

1. The expanded SUBTLEX-assisted lexicon, authored phrase bank, long-window alignment, reach-sensitive index/ranking, and UK non-rhotic beta address the shallow-result audit.
2. Full-vocabulary local semantic retrieval can add meaning neighbours outside the original sound pool before late fusion.
3. Families is the default explorer; Focus, the drawer, backfilling filters, and a truthful local phonetic kNN map make the result set easier to use on small monitors.
4. Automated checks establish implementation invariants only. The low `orange` Pivot identity recall, a machine-assisted labelled-pool lead far below the `+.03` gate, and zero human validation keep both milestones open at their evidence gates.

The current automated release candidate passes 70/70 unit/data checks, whole-tree lint and TypeScript, evaluator, sound-benchmark, and semantic-index validation, 10/10 root Chromium production scenarios, and 12/12 `/RhymeGraph` Pages production scenarios, including the full Chromium path plus Firefox/WebKit core loops. The unit/data total includes two worker-artifact compatibility cases plus scorer regressions for inverted stress, Pivot intent, headroom, phrase coverage, and mixed-OOV families. These are release and interaction guardrails, not ranking or target-writer validation.

## Decisions needed from the owner

None blocks local evaluation, but these should be settled before a broader invitation:

1. **Project licence:** the repository is public but has no top-level licence; public source is not automatically open source.
2. **Explicit vocabulary:** uncensored by default, filtered by default, or a remembered local control.
3. **Dialect review:** which UK region/community should review and eventually replace or refine the broad non-rhotic beta.
4. **Future research submission:** current research is local/manual export only; whether a separate explicit opt-in submission path should ever exist remains undecided.

No roadmap item authorizes scraping lyrics, reconstructing a commercial rhyme dictionary, or building an artist-imitation system.
