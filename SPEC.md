# RhymeGraph

## Product and technical specification

> [!IMPORTANT]
> This remains a product and architecture design document, not a claim that every proposed feature has shipped or been validated. It has been revised to reflect the v0.3 implementation where the architecture materially changed. See [implementation status](./docs/STATUS.md), the [implementation diary](./docs/IMPLEMENTATION_DIARY.md), and the [current roadmap](./docs/ROADMAP.md) for the operational source of truth.

| Field | Value |
|---|---|
| Status | Draft v0.3 — implementation-aligned; product validation pending |
| Working title | RhymeGraph |
| Initial audience | Rappers and lyricists |
| Initial platform | Local-first web application |
| Core promise | Find the next useful word by sound, meaning, and flow—not by spelling |
| Runtime dependency policy | No proprietary dictionary or inference API required |
| Last revised | 2026-08-15 |

## 1. Executive decision

RhymeGraph is worth prototyping.

The opportunity is not “a rhyming dictionary displayed as a graph.” That would be easy to copy and only marginally better than a list. The stronger product is an **adaptive word-navigation instrument** whose recommendations respond to four things at once:

1. What the writer has already chosen to rhyme.
2. What the current lyric is trying to mean.
3. What sound relationship the writer will tolerate.
4. What will fit the stress and cadence of the line.

The first version should prove one loop:

```text
write/select → explore a local sound neighbourhood → pin a direction
             → recommendations adapt → insert → keep writing
```

The graph is the interaction model and visual signature. The ranking system is the product. Browser embeddings are one ranking signal, not the foundation of the rhyme model.

## 2. Product definition

### One sentence

RhymeGraph is a private, local-first writing workspace where rappers and lyricists traverse a graph of words and phrases connected by sound, meaning, rhythm, and linguistic relationships.

### The job to be done

> When I know the sound, feeling, or rhythmic shape I want but not the next word, help me discover an option I would genuinely use without taking me out of the writing flow.

### What it is not

- Not a binary perfect-rhyme checker.
- Not a thesaurus with a network animation.
- Not an AI that writes finished verses for the user.
- Not a global two-dimensional map of every English word.
- Not dependent on Datamuse, RhymeZone, or another proprietary runtime service.

### Initial positioning

Design explicitly for rap first. Rap makes loose rhyme, multisyllabic rhyme, internal rhyme, cadence, slang, clipped pronunciation, and phrase boundaries unavoidable. A system good enough for rap can later serve songwriting and poetry; a generic poetry tool may never become good enough for rap.

## 3. The differentiating product model

A candidate is useful only when several independent relationships line up. RhymeGraph therefore maintains separate spaces and combines them late:

```text
                         ┌─ pronunciation and dialect
                         ├─ phonetic alignment
selected sound anchors ──┤
                         └─ rhyme-family inference
                                      │
current line / concept ─ semantic embedding ─┐
                                             ├─ dynamic ranker ─ diverse candidates
desired cadence ──────── prosodic fit ───────┤
                                             │
filters / metadata ───── lexical utility ────┘
```

Do not concatenate every feature into one permanent “universal word embedding.” Keeping the signals separate allows:

- A sound/meaning control that behaves predictably.
- Dialect-specific pronunciation without retraining semantic vectors.
- Explanations for surprising recommendations.
- Different ranking modes using the same underlying data.
- Better experimentation and debugging.

## 4. Product principles

1. **Sound is a spectrum.** Preserve component similarities instead of forcing every pair into perfect/near/non-rhyme buckets.
2. **Context changes the answer.** `bank` in a line about money should explore a different semantic region from `bank` in a line about a river.
3. **Selection is a query.** Pinning `time`, `mine`, and `divine` should infer a shared sound family, not merely store favourites.
4. **Show a neighbourhood, not a database.** Fifteen excellent options beat five hundred technically related words.
5. **Stable beats spectacular.** The graph must remain readable and spatially stable as suggestions update.
6. **Explain the relationship.** Users should be able to see vowel, coda, stress, meaning, and confidence contributions.
7. **Protect writing flow.** Phonetic results appear immediately; slower semantic enhancement arrives progressively.
8. **The writer remains the author.** Suggest words and paths rather than generating finished bars by default.
9. **Local-first is a feature.** Drafts and later recordings stay on the device unless the user deliberately enables sync or remote processing.
10. **Taste is learned after a baseline exists.** Begin with inspectable rules and evaluation; introduce personal ranking only when feedback data is meaningful.

## 5. Core interaction

### Workspace

The primary desktop workspace contains:

- **Draft:** a focused lyric scratchpad with active-line and text-selection awareness.
- **Graph:** a bounded neighbourhood centred on the active anchor or rhyme family.
- **Inspector:** pronunciation, score explanation, filters, definitions, and actions.
- **Tray:** pinned words/phrases representing the current sound direction.

On small screens, **Focus** can give Explore most of the viewport while a dismissible drawer holds candidate detail. Families, Map, and List remain synchronized representations; the list is the precise keyboard/accessibility path.

### Core loop

1. The writer types a line or enters a word.
2. They select a word, syllable span, or phrase as the sound anchor.
3. RhymeGraph immediately shows a phonetic neighbourhood.
4. When explicitly enabled, semantic retrieval can add full-vocabulary meaning neighbours before the combined exact rerank.
5. The writer previews, expands, pins, dismisses, or inserts a candidate.
6. Pinning changes the inferred rhyme family and reranks the neighbourhood.
7. Expanding moves through the graph while preserving a breadcrumb trail.
8. Insertion returns focus to the draft and is undoable as one operation.

### Three explicit recommendation intents

The application should infer a default but make these modes visible:

#### Continue

Find candidates that consistently fit all pinned sound anchors.

```text
time + mine + divine → continue the shared /aɪ/ + nasal family
```

#### Bridge

Hold one sound direction while moving toward a semantic goal.

```text
sounds like “violence” + means “quiet” → silence
```

#### Pivot

Use the last selection to move into a neighbouring sound family without abandoning the existing cadence.

This distinction is clearer and more useful than silently averaging all selected vectors.

### Node actions

Every candidate supports:

- Preview definition and pronunciation.
- Audition pronunciation when audio support exists.
- Pin/unpin.
- Expand from here.
- Insert at cursor.
- Replace selected text.
- Dismiss for the current session.
- Mark “more like this” or “too loose” during evaluation builds.

## 6. Graph design

### A local, evidence-backed graph

Render approximately 12–24 candidate nodes, the active centre, and at most four pinned anchors (five anchors total). Never render the full lexicon.

The v0.3 map is local to the current visible candidate set. Candidate-to-candidate edges are sparse phonetic k-nearest-neighbour relationships computed from actual pronunciation comparisons. Anchor edges record candidate-to-query sound. Query-to-candidate semantic scores must not be presented as pairwise candidate semantics.

The layout must encode something understandable:

- Radius from centre: candidate-to-anchor sound distance.
- Local grouping: actual candidate-to-candidate phonetic similarity.
- Edge width: relationship strength.
- Edge style: distinguish candidate-neighbour edges from anchor edges; estimated anchor forms may be dashed.
- Node size: overall recommendation score in the current map.
- Node state: pinned and active rings; visited/inserted state remains a possible extension.

Use a deterministic, seeded, bounded layout so nodes do not jump randomly after each rerank. A fixed local force/collision pass is acceptable; an unconstrained or unexplained global projection is not.

The default v0.3 explorer is the family board—locked ending, vowel, consonant, phrase/mosaic, and meaning—because it remains legible on small monitors. A later pairwise semantic or fused graph is an evaluation experiment, not something inferred from independent query scores. A corpus-wide embedding or k-means map remains out of scope until local exploration proves useful.

### Why a list remains present

The graph helps discovery and memory. A list is better for fast comparison, keyboard navigation, screen readers, and inspecting exact scores. They are two views of the same result set, not competing product modes.

### Visual restraint

The interface should resemble a creative audio tool more than a children’s dictionary, but it should remain calm during long sessions. Motion communicates state changes; it must not become ambient decoration. Respect reduced-motion preferences and never rely on colour alone.

## 7. Recommendation request contract

The ranking system consumes an explicit query state:

```ts
interface RecommendationQuery {
  soundAnchors: Anchor[];
  intent: "continue" | "bridge" | "pivot";
  draftContext?: {
    activeLine: string;
    precedingLines?: string[];
    selectedSpan?: [number, number];
  };
  conceptPrompt?: string;
  cadenceTarget?: CadenceTarget;
  dialect: DialectProfileId;
  weights: {
    sound: number;
    meaning: number;
    rhythm: number;
    adventurousness: number;
  };
  filters: LexicalFilters;
  excludedIds: number[];
}
```

Each result is explainable:

```ts
interface Recommendation {
  lexicalItemId: number;
  pronunciationId: number;
  senseId?: number;
  overall: number;              // calibrated 0..1
  components: {
    phonetic: number;
    stressedVowel: number;
    vowelSequence: number;
    coda: number;
    consonance: number;
    stress: number;
    cadence: number;
    semantic: number;
    utility: number;
    pronunciationConfidence: number;
  };
  matchedSpan: {
    anchorPhonemes: [number, number];
    candidatePhonemes: [number, number];
  };
  labels: RelationshipLabel[];
  explanation: string[];
}
```

Labels such as `assonance`, `consonance`, `slant`, `full-tail`, and `mosaic` are non-exclusive descriptions derived from component scores. The scores—not the labels—drive ranking.

## 8. Lexical data model

Spelling, pronunciation, and meaning are different entities. The schema must support homographs, multiple senses, alternate dialects, and user corrections.

```ts
interface LexicalItem {
  id: number;
  text: string;
  normalizedText: string;
  kind: "word" | "phrase";
  pronunciationIds: number[];
  senseIds: number[];
  frequencyBand?: 1 | 2 | 3 | 4 | 5;
  partsOfSpeech: PartOfSpeech[];
  register: RegisterTag[];
  flags: LexicalFlag[];
  provenanceIds: number[];
}

interface Pronunciation {
  id: number;
  lexicalItemId: number;
  dialect: DialectProfileId;
  phonemes: PhonemeId[];
  syllables: Syllable[];
  stressPattern: Array<0 | 1 | 2>;
  source: "lexicon" | "g2p" | "user";
  confidence: number;
}

interface LexicalSense {
  id: number;
  lexicalItemId: number;
  partOfSpeech: PartOfSpeech;
  gloss: string;
  semanticEmbeddingRef?: number;
  relationIds: number[];
  provenanceIds: number[];
}
```

### Initial data sources

- **Pronunciation:** CMUdict through `cmu-pronouncing-dictionary`, with upstream acknowledgement and bundled licence terms.
- **Meanings and lexical metadata:** WordNet 3.1 through `wordnet-db`; the semantic build derives bounded primary definitions and gloss/POS/synonym documents rather than shipping the source database files.
- **Spoken coverage and utility:** SUBTLEX-US through `subtlex-word-frequencies`; this is a US subtitle-frequency source, not a pronunciation or dialect corpus.
- **Phonological feature definitions:** an audited internal table, potentially derived from MIT-licensed PanPhon data.
- **Authored layers:** small, labelled slang/reference/UK additions; 8 pack phrase fixtures; and 151 ordinary performance-phrase building blocks composed from existing word pronunciations at runtime.
- **Broader phrase corpora, complete UK pronunciations, and etymology:** unresolved until quality and redistribution rights are audited.

Every generated record should carry provenance. Data without known redistribution rights does not enter a shipped asset. Commercial rhyme dictionaries and lyric sites are not scraped; the authored phrase layer is not copied artist text or a hidden style corpus.

## 9. Phonetic representation

### Important decision

Do not use MiniLM or an ordinary text embedding to determine rhyme. Rhyme requires pronunciation, stress, syllable structure, and position-sensitive sound comparison.

Each phoneme is represented through articulatory features rather than as an arbitrary token:

- Vowels: height, backness, roundedness, tenseness, length/diphthong movement.
- Consonants: place, manner, voicing, continuance, sonority, nasality, and sibilance.
- Structure: onset/nucleus/coda role, syllable boundary, word boundary, and distance from primary stress.

### Detailed comparison

The definitive pairwise score comes from stress-aware sequence alignment:

1. Locate primary and secondary stressed nuclei.
2. Generate one- to six-syllable suffix windows around plausible rhyme material.
3. Align phoneme-feature sequences with weighted insertion, deletion, and substitution costs.
4. Compute separate vowel, coda, consonance, stress, and whole-span scores.
5. Score salient-window coverage and syllable-depth balance so a short exact ending does not masquerade as a full long rhyme.
6. Prefer longer coherent matches over isolated coincidental phonemes, but spend depth rewards only inside the base score's remaining headroom.
7. Apply conservative dialect-specific equivalence and rhoticity rules.
8. Calibrate scores separately by syllable shape so short words do not dominate unfairly.

Long-span depth rewards require compatible stress rather than rewarding length alone. Phrase-involved comparisons also require stronger coverage than ordinary word-suffix rhyme, so an exact final word does not outrank a coherent cross-boundary chain by itself. A **full rhyme** label requires a stress component of at least `.70`; inverted word-stress patterns must not saturate into that label, and their explanation must explicitly say **emphasis differs**.

The exact cost matrix is a product hypothesis and must be tuned against human judgments. It belongs in versioned data/configuration, not scattered constants.

### Retrieval representation

Detailed alignment is too expensive across the full vocabulary. The v0.3 multi-channel index uses signatures containing:

- Final one to three exact/coarse vowel symbols.
- Exact and coarse outer-vowel sketches spanning the first and third vowels of the last three-vowel window.
- Exact final coda.
- Final one to three consonant symbols.
- Coarse voicing-aware consonant-family suffixes of length two and three.
- Final two or three stress positions.

Posting lists for exact/coarse vowel sequences and three-vowel outer sketches, vowel families, codas, exact consonant suffixes, coarse voicing-aware consonant families, and stress retrieve a bounded union; exact alignment reranks it. Reach controls shortlist breadth and candidate diversity. Authored phrases and exact semantic-union terms are retained explicitly. A learned phonetic embedding may later improve recall, but the current debt is measurable: a focused `orange` Pivot audit recovered 8/25 exhaustive top-result identities despite only about .0031 mean score regret.

## 10. Semantic embeddings in the browser

Use `@huggingface/transformers` in a Web Worker. The current baseline is an ONNX-compatible, quantized `sentence-transformers/all-MiniLM-L6-v2`, producing normalized 384-dimensional embeddings. Model choice remains provisional until evaluated on lyric-context retrieval.

### What is embedded

Avoid treating an isolated spelling as a complete permanent meaning. In the v0.3 implementation:

- the browser embeds the active line or explicit concept query once per semantic search;
- the build embeds one bounded document per compact word and explicit pack fixture;
- a document combines spelling, available POS, primary WordNet gloss material, and a small synonym set;
- a bounded primary WordNet definition is retained for explanation when available;
- runtime-authored performance phrases remain phonetic-only unless they are also explicit semantic-index entries.

This word-document baseline is deliberately smaller and easier to audit than a sense-level vector graph. It improves candidate generation but does not solve polysemy or lyric-context meaning; sense-level indexing remains an evaluated alternative.

### Distribution strategy

- The application shell and phonetic search work before the model is ready.
- Load semantic inference lazily and show honest progress on first use.
- Use the current single-thread WASM path; evaluate WebGPU separately before changing the compatibility and benchmark baseline.
- Cache model/index assets through ordinary browser caching; a service worker is not yet shipped.
- Host pinned model artifacts ourselves in production so the product is not operationally dependent on the Hugging Face Hub.
- Pin model and tokenizer revisions; never silently change embedding space.
- Store precomputed word-document embeddings with the same pinned model/data recipe and integrity metadata.
- Content-revision lexicon/index URLs and verify the semantic binary with WebCrypto SHA-256 in the browser.
- Publish versioned, self-contained worker entrypoints and retain the live prior Pages chunk `workers/chunks/public-path-B_7tJUiL.js` for a cache window; cover that boundary with an artifact regression and bump worker and asset namespaces together on future coupled changes.

### v0.3 semantic index strategy

Do not embed every candidate during a query. The build precomputes 54,140 row-wise int8 MiniLM word-document vectors of 384 dimensions. The browser embeds only the query and scans the local index. A CDF fitted to unrelated corpus pairs produces an available percentile-like score; the current UI and ranking use a fixed clamped `(cosine - null mean) / (4 × null SD)` strength. Those hits are unioned with the phonetic shortlist, receive exact sound scores, and enter late fusion. This lets meaning introduce a candidate absent from the original sound pool without treating either transform as a relevance probability or batch-stretching a weak leader to 100.

The vocabulary is currently small enough to evaluate a direct local scan before introducing an approximate-nearest-neighbour dependency. The 21,006,336-byte binary and 3,386,621-byte manifest total 23.26 MiB raw; 35,470 entries (65.5%) carry a bounded definition. The complete optional semantic path is about 69.10 MiB raw; its exact file total differs between root and Pages exports because the versioned worker embeds the deployment base path. The binary SHA-256 is `2e48ce37bd70f1b1b4805a915214071ec16fe81a157f861c3621f9526b789d5e`; the manifest SHA-256 is `168d0c07e41daefecdc4f06667c3b349d8474948d890a92bceaee2e45174cecf`; and CI verifies six exact model/tokenizer/config/vocabulary files with set hash `551f651982a81f63580c48b0fe704b66fab2be32bfd562123ee3bc1636273cd8`. A local Node checker observed a 41.53 ms median full scan.

One headless Chromium 151/i7-7500U sample against a dirty local static export observed cold DOM/sound/meaning/combined readiness at `253.07/2218.10/4162.42/5155.22 ms` and same-context repeat readiness at `81.44/3243.22/2218.32/3753.41 ms`. Playwright finished 24/24 cold requests (10/10 semantic) and 17/17 repeat requests (3/3 semantic), with zero failures or in-flight work. It observed `71,692,443` semantic and `74,904,430` total encoded-response-body bytes cold; repeat semantic and total encoded response bodies were both `21,006,336` bytes. These are not wire-transfer or memory totals; one sample is not p75. Physical-mobile performance and human usefulness remain unmeasured.

## 11. Candidate generation and ranking

### Retrieval pipeline

```text
1. Resolve anchor pronunciations for the selected dialect
2. Infer a shared pattern when several anchors are pinned
3. Union candidates from multi-channel phonetic indexes
4. Add independently retrieved full-vocabulary semantic candidates when requested
5. Apply hard lexical filters
6. Run detailed phonetic alignment
7. Score meaning, stress/cadence, utility, and confidence
8. Fuse calibrated component scores
9. Diversify and reserve useful phrase/family coverage according to Reach
10. Backfill the filtered visible set from the 96-result sound or 120-result hybrid pool
11. Build family channels, actual local phonetic kNN edges, and explanations
```

Pool sizes are versioned ranking parameters rather than product promises. The v0.3 worker exposes 96 sound candidates or 120 hybrid candidates to the UI for filtering/backfill, while the family board/map/list show a smaller legible subset. The indexed exact-rerank pool expands with Reach and pin count; authored phrases and exact semantic-union terms are protected from the phonetic cap. This currently exceeds the roadmap's eventual compact-pool ambition and must be tuned only after identity-recall and timing evidence exist.

### Late-fusion score

```text
base(c) =
    Wp × phonetic_fit(c)
  + Ws × semantic_fit(c)
  + Wr × prosodic_fit(c)
  + Wu × lexical_utility(c)
  + Wq × pronunciation_confidence(c)
  - penalties(c)
```

The UI controls transform weights and thresholds; “adventurousness” should primarily lower phonetic gates and increase diversity, not merely add a mysterious looseness bonus.

After scoring, apply maximal marginal relevance or an equivalent selection step:

```text
visible_score(c) = relevance(c) - diversity_weight × similarity(c, already_visible)
```

This prevents a screen containing `time`, `times`, `timed`, and twenty nearly indistinguishable variants.

### Hard filters versus soft preferences

Hard filters include explicit content policy, user exclusions, impossible syllable constraints, and exact duplicate forms. Frequency, part of speech, register, dialect confidence, and semantic fit should normally be soft preferences; hard filtering them can hide the surprising option that makes the product worthwhile.

## 12. Multi-pin rhyme-family inference

This is a core differentiator and part of the first prototype.

The active anchor plus at most four pins form a family of no more than five total anchors. For several sound anchors:

1. Align their strongest pronunciation spans.
2. Find features shared by all anchors and features shared by a majority.
3. Represent the family as required, preferred, and free phonetic positions.
4. Retrieve against this family signature.
5. Score candidate consistency against every anchor as well as the inferred family.

```text
family_consistency(c) =
    0.68 × mean(similarity(c, anchors))
  + 0.32 × min(similarity(c, anchors))
```

These are the current experimental v0.3 weights, not validated constants. The minimum term prevents a centroid-near candidate that clashes badly with one pinned word from ranking too highly. Components shared across comparisons are still exposed as the family explanation; a separately learned family-pattern term remains a design option rather than a shipped score.

The UI should visualize the inferred pattern, for example:

```text
time      T  AY  M
mine      M  AY  N
divine D IH V  AY  N
              └── shared stressed /AY/ + nasal coda family
```

Users may remove an anchor or mark it as semantic-only if it is distorting the family.

## 13. Phrases and mosaic rhyme

Phrase support is essential to the product vision, but unrestricted phrase generation would overwhelm the first build.

### v0.3 commitment

The compact pack contains **8 explicit authored fixtures**. The worker additionally composes **151 authored ordinary performance-phrase building blocks** from checked-in word pronunciations at startup. Selected phrases made only of known words can also be represented compositionally. RhymeGraph does not claim exhaustive phrase search, real-world phrase frequency, or a complete user-managed phrase library.

Phrase representation concatenates pronunciations while retaining word boundaries. Alignment may cross those boundaries, allowing a single word to match several words. Ranking includes:

- Phonetic span quality.
- Stress and syllable compatibility.
- Phrase frequency/plausibility.
- Semantic fit.
- Boundary awkwardness penalty.

Only explicit, deliberately authored phrases are shipped or composed. Arbitrary Cartesian combinations are not precomputed. The list is project-authored rather than extracted from lyrics, artist catalogues, or an n-gram corpus; it must still be judged for grammar and usefulness.

A larger phrase source remains a data and evidence decision because many obvious lyric and n-gram corpora have unsuitable redistribution terms. User-local phrase management is preferable to quietly introducing an unreviewed corpus.

## 14. Dialect and pronunciation

Dialect is part of the data model even though the source pronunciation pack remains CMU-based General American.

### v0.3 implementation

- Label the CMU-based US pronunciation basis clearly.
- Permit alternate pronunciations already present in CMUdict.
- Persist a choice between General American and **UK non-rhotic · beta**.
- For the beta, conservatively drop post-vocalic `R` when no following vowel licenses linking `R`, and map only unstressed rhotic `ER0` to schwa/`AH0`.
- Preserve stressed `ER` so NURSE remains distinct from STRUT—for example, `bird` must not become `bud`.
- Keep authored performance forms and UK/reference tags transparent.
- Do not describe SUBTLEX-US utility or a rhoticity transform as a complete UK dialect pack.

Pronunciation selection UI, user overrides, and G2P remain future work. If G2P is introduced, estimated results must be labelled.

### Later dialect packs

- A reviewed UK/regional profile is the first additional full target beyond the beta transform.
- Packs provide pronunciations plus merger/equivalence configuration.
- A personal profile may override individual words without inventing a false universal accent label.
- Dialect differences affect sound ranking but not semantic embeddings.

Dialect support is not a flag that swaps one vowel table. Rhoticity, vowel systems, stress, and word-specific pronunciations all matter.

## 15. Metadata and alternate graph layers

Useful metadata includes:

- Syllable count and stress.
- Part of speech and inflection family.
- Frequency band.
- Slang, regional, formal, archaic, technical, and offensive-use labels.
- Definitions and lexical senses.
- Synonym, antonym, hypernym, and related-concept links.
- Pronunciation source, dialect, and confidence.
- Etymology and shared-root relationships.

Metadata serves three different purposes and must not be conflated:

1. **Ranking:** frequency, register, grammatical fit.
2. **Explanation:** definition, pronunciation, source confidence.
3. **Exploration:** etymology and lexical relations as optional graph layers.

Etymology should initially be an explicit “Origins” layer rather than a hidden rhyme-ranking signal. Shared ancestry is interesting but does not necessarily make a word useful in a bar.

## 16. Voice and performed cadence

Voice is the strongest expansion path after the typed loop works. The useful product is not generic speech-to-text plus generic text-to-speech; it is **delivery-conditioned retrieval**.

### Performance loop

```text
write a line → perform it → align words/syllables to audio
             → derive cadence target → suggest replacements that fit the pocket
```

### Phase A: record known lyrics

When the text already exists, prioritize forced alignment over unconstrained transcription:

- Capture audio with Web Audio/MediaRecorder.
- Align the known lyric to word, syllable, or phoneme timestamps.
- Estimate syllable durations, onset positions, rests, emphasis, and tempo-relative placement.
- Convert this into a `CadenceTarget` used by the existing ranker.

This is smaller and more valuable than asking STT to rediscover text the application already knows.

### Phase B: freestyle capture

Add local speech recognition for performed input. Transformers.js can run compatible Whisper models through WebGPU/WASM, but model download, device support, rap transcription accuracy, and timestamp quality require a separate spike.

### Phase C: audition

TTS initially serves pronunciation audition and dialect comparison. Ordinary TTS should not be marketed as realistic rap performance. Rhythm-conditioned synthesis or voice cloning is outside the planned scope until quality, consent, impersonation, and abuse risks are addressed.

### Audio privacy

- Microphone access is explicit and contextual.
- Recordings remain local by default.
- Temporary audio is distinguishable from saved takes.
- No voice training or retention without separate, informed consent.
- A one-action delete control removes stored audio and derived timing features.

## 17. Prototype scope

### Design target represented in the current prototype

- Desktop-first responsive web application.
- Scratchpad with active-line context and selection.
- 54,132 compact English words and 59,783 pronunciations, filtered from CMUdict using WordNet/SUBTLEX and transparent authored additions.
- CMU-based General American pronunciation plus a conservative selectable UK non-rhotic beta; richer pronunciation selection remains incomplete.
- Immediate phonetic retrieval and detailed component scoring.
- Browser semantic inference using a pinned quantized embedding model and optional full-vocabulary int8 word-document index.
- Continue, Bridge, and Pivot intents.
- Multi-pin family inference.
- Family-first explorer plus optional local phonetic kNN map and synchronized ranked list.
- Sound/meaning and Reach controls, a dialect switch, and syllable/part-of-speech filters; rhythm/frequency controls remain design ideas.
- Candidate explanations and pronunciation display.
- Inspect, insert/replace the selected span, pin, expand, backtrack, and insertion undo; dismiss/evaluation feedback remains future work.
- Local project persistence with no account.
- Eight pack phrase fixtures plus 151 project-authored ordinary performance-phrase building blocks, with no scraped lyric corpus.

### Deferred

- Comprehensive/user-managed phrase search.
- A full audited UK/regional pronunciation pack beyond the non-rhotic beta.
- Automatic verse-wide internal-rhyme colouring.
- Accounts, sync, and collaboration.
- Personal learned ranking.
- Recording, STT, forced alignment, and TTS.
- Mobile-native applications.
- Finished-bar or verse generation.

### Deliberate simplifications

- One language: English.
- One primary pronunciation pack.
- One local project format.
- One active sound anchor plus at most four pinned anchors (five total).
- At most 24 visible candidate nodes.
- No server required for ordinary prototype use.

## 18. Demo acceptance script

The prototype is compelling only if a reviewer can complete this sequence without explanation:

1. Type or paste two lyric lines.
2. Select the intended rhyme word or phrase.
3. See useful phonetic candidates before the semantic model finishes loading.
4. Watch results refine without the graph losing spatial continuity.
5. Move the sound/meaning control and understand why the neighbourhood changes.
6. Pin two or three candidates and see a coherent shared sound pattern appear.
7. Choose Continue, Bridge, or Pivot and receive visibly different recommendations.
8. Expand through at least three nodes and backtrack.
9. Inspect why an unexpected candidate matches.
10. Insert it into the draft and undo in one step.
11. Reload the application and recover the local draft and pins.
12. Disconnect the network after assets are cached and repeat the core flow.

This is an acceptance target rather than a statement that all twelve steps currently pass. In particular, no service worker is shipped, so step 12 is not guaranteed; semantic refinement and map continuity also require observed usability testing.

## 19. Proposed technical architecture

### As-built v0.3 repository shape

```text
rhymegraph/
  app/                    # Next.js UI, notices, and static-export shell
  lib/
    phonetics/            # alignment, indexed retrieval, dialect transform
    phonetic-search/      # browser worker/client and authored phrase blocks
    semantic/             # browser worker/client and int8 index runtime
    search/               # semantic/phonetic late-fusion policy
    explorer/             # deterministic local candidate graph
  scripts/                # data/index builds, workers, Pages, evaluation
  evaluation/             # provisional scenarios and evaluator
  public/
    data/                 # compact lexicon and optional semantic artefacts
    models/               # pinned local model/tokenizer
    workers/              # generated browser-worker bundles
    licenses/             # redistributed licence texts
  tests/                  # Node and Playwright checks
  docs/                   # status, roadmap, diary, and screenshots
```

### Current technology choices

- TypeScript, React, and Next.js static export for the application; Vite bundles only the workers.
- Plain SVG/DOM graph rendering initially; 30 nodes do not justify a heavy graph engine.
- Separate Web Workers for phonetic search and semantic inference/retrieval.
- `@huggingface/transformers` with pinned ONNX model artifacts.
- localStorage for draft/settings and per-tab sessionStorage for explicitly started research capture; on Pages these are shared-origin, not path-isolated.
- Node build scripts for lexicon, semantic-index, evaluation, and benchmark work.
- Node's test runner through `tsx` for unit/data checks and Playwright for browser paths.

These choices are defaults for speed, not permanent commitments. No backend, vector database, WebGL renderer, telemetry service, or proprietary runtime API should be introduced until a measured product need exists.

### Runtime flow

```text
compact lexical pack ────────┐
phonetic posting indexes ────┼─ phonetic Worker ─ exact scores + explanations
anchors/pins/reach/dialect ──┘                         ▲
                                                        │ semantic union
context/concept ─ MiniLM query ─ local int8 index ──────┘
                                                        │
                                            late fuse + diversify ─ UI
```

Semantic enhancement is progressive. A late semantic response carries a query revision ID and is discarded if the user has already changed the query.

### Versioning

Reproducible reports and future portable project/search snapshots should carry:

- Lexical data version.
- Phonetic-cost configuration version.
- Dialect-pack version.
- Semantic model/tokenizer revision.
- Ranking configuration version.

This makes evaluation reproducible and prevents incompatible cached vectors from being mixed.

## 20. Performance budgets

Budgets are hypotheses to validate on representative mid-range hardware:

- Application interactive without semantic model: under 2 seconds on a warm load.
- Phonetic neighbourhood update after typing/pinning: p95 under 100 ms.
- Graph update: no long task over 50 ms; target 60 fps during intentional motion.
- Warm semantic query embedding: target under 300 ms with WebGPU and under 1 second with WASM.
- First visible result set: never blocked on semantic inference.
- Core compressed lexical/index download: target under 10 MB.
- Optional semantic model download: target under 35 MB quantized.
- Optional quantized word-document vectors/index: target under 25 MB initial pack.
- Browser memory after model load: target under 350 MB on desktop.

If these budgets cannot be met, reduce vocabulary/sense-pack size or add on-demand shards before introducing a required backend.

The current v0.3 verification snapshot passes 70/70 unit/data checks, whole-tree lint and TypeScript, evaluator, sound-benchmark, and semantic-index validation, 10/10 root Chromium production scenarios, and 12/12 `/RhymeGraph` Pages production scenarios, including the full Chromium path plus Firefox/WebKit core loops. Two unit/data cases cover artifact compatibility for the retained live prior Pages chunk; additional scorer cases protect inverted stress, Pivot intent, headroom, phrase coverage, and mixed-OOV families. These prove release mechanics and tested interactions, not the performance budgets above or recommendation usefulness.

## 21. Evaluation

### Golden set before UI polish

Create at least 200 reviewed scenarios containing:

- Tight and loose single-word queries.
- Assonance-dominant and consonance-dominant cases.
- Multisyllabic and mosaic/phrase cases.
- Several pinned anchors.
- A sound target plus a conflicting semantic goal.
- Polysemous words in disambiguating lines.
- Different syllable and stress shapes.
- General American/UK divergence cases.
- Slang, clipped spellings, names, and invented words.
- Known false positives from naive vowel matching.
- Useful surprising candidates and plausible-but-useless candidates.

Target rappers and lyricists should provide pairwise or short-list judgments. “Does it rhyme?” is insufficient; ask “Would this be useful in this context?”

### Offline metrics

- Recall of judged-useful candidates at 10 and 25.
- nDCG@10 for ranked usefulness.
- Pairwise preference accuracy against baseline ranking.
- Sound-family diversity at 20.
- Phrase/mosaic coverage.
- False-positive rate among high-confidence results.
- Score calibration by syllable count and relationship type.
- Latency and memory budgets.

### Product metrics

- Time to first previewed and first inserted suggestion.
- Insertions retained after ten minutes rather than immediately undone.
- Percentage of sessions using pinning and multi-hop traversal.
- Median traversal depth.
- Return rate for projects containing real drafts.
- User-rated “surprising and useful” recommendations.

Click-through alone is not success; novelty can attract clicks without improving writing.

## 22. Data and privacy policy

### Data provenance

Every input source receives a manifest containing:

- Source URL and retrieved version/date.
- Licence and required attribution.
- Original checksum.
- Importer version.
- Fields derived from the source.
- Whether redistribution and commercial use have been reviewed.

Generated assets include a machine-readable provenance map. Do not scrape commercial rhyme dictionaries or lyric sites to reconstruct their product.

### Draft privacy

- Drafts are local by default.
- The draft field disables browser spellcheck; browser extensions, keyboards, and input methods remain outside the application's request boundary.
- Telemetry is off in development and opt-in if introduced publicly.
- Evaluation feedback can be submitted without submitting the entire draft.
- Any event schema must distinguish displayed, previewed, inserted, retained, dismissed, and undone suggestions.
- Export and full local deletion are supported before accounts are considered.

## 23. Risks and responses

### The results are linguistically defensible but artistically dull

Build the golden set with actual target users, include diversity in ranking, and optimize for contextual usefulness rather than phonetic purity alone.

### The graph is a gimmick

Test graph-plus-list against list-only. Keep the graph only if it improves discovery, recall of explored options, or traversal depth without slowing insertion.

### MiniLM is poor at isolated words or lyric language

Use sense glosses and line context, benchmark alternative small embedding models, and preserve model interchangeability. Do not train a new model before establishing a failure dataset.

### Browser downloads are too large

Progressively load semantic capability, shard vectors, retain phonetic-only operation, and measure actual cold-start abandonment.

### CMUdict creates a false claim of universal English

Label it honestly, keep the broad non-rhotic transform in beta, accept pronunciation overrides, and prioritize reviewed word-specific UK/regional data after the core loop.

### Slang, spellings, and names fail

Normalize common lyric spellings, use local G2P with confidence, expose correction, and preserve user pronunciations separately from upstream data.

### Phrase data cannot be redistributed

Ship user-entered phrases and a small audited pack; do not quietly build on a corpus whose licence prevents product redistribution.

### Voice work overwhelms the product

Do not begin it until typed suggestions meet retention and ranking targets. Start with known-text alignment, not a broad audio platform.

## 24. Delivery plan and gates

### Stage 0 — evidence, 1–2 weeks

- Build the first 50–100 golden scenarios.
- Audit pronunciation, meaning, frequency, phrase, and dialect sources.
- Compare two deterministic phonetic scorers and one existing open-source baseline.
- Benchmark MiniLM in current desktop browsers.
- Prototype static graph/list interactions with fixture results.

**Gate:** proceed only if the scorer retrieves loose matches that reviewers prefer over a basic CMUdict suffix baseline.

### Stage 1 — vertical slice, 2–4 weeks

- Scratchpad and text selection.
- Lexical pack and phonetic worker.
- Single-anchor retrieval and explanations.
- Browser semantic worker.
- Stable graph/list view.
- Insert, replace, expand, dismiss, history, and persistence.

**Gate:** a user can complete the demo script, and the top 20 contains useful results on a clear majority of the golden scenarios.

### Stage 2 — defining interaction, 2–3 weeks

- Multi-pin family inference.
- Continue, Bridge, and Pivot.
- Weight controls and diversity.
- Small phrase pack/user phrase support.
- Evaluation instrumentation.

**Gate:** multi-pin ranking beats the best single-anchor/centroid baseline in blinded preference tests.

### Stage 3 — product hardening

- Accessibility and mobile adaptation.
- Data/model caching and offline behaviour.
- Better unknown-word flow.
- Performance and bundle work.
- Expanded benchmark and target-user sessions.

### Stage 4 — performed cadence research

- Known-text forced-alignment spike.
- Cadence representation and fit score.
- Local STT feasibility for freestyle.
- Pronunciation audition.

**Gate:** timing-derived cadence features improve replacement preferences compared with text stress alone.

## 25. Decisions now fixed

Unless review changes them, implementation should proceed with these assumptions:

1. Rap is the initial product lens.
2. The product is a writing workspace with a graph, not a graph demo with a text box.
3. Phonetic and semantic representations remain separate.
4. Semantic inference runs locally in the browser.
5. The first version requires no user account.
6. The first version requires no proprietary runtime API.
7. CMU-based General American is the labelled source pack; a selectable UK non-rhotic beta is an explicitly limited scoring profile, not a full dialect pack.
8. Multi-pin family inference is MVP, not an enhancement.
9. Phrase support uses 8 fixtures and 151 transparent project-authored building blocks, not exhaustive generation or scraped lyrics.
10. Voice follows proof of typed recommendation quality.

## 26. Questions for review

Only four decisions materially change the first build:

1. **Product posture:** should RhymeGraph remain a private writing instrument, or is publishing/sharing work part of the first public story?
2. **Open-source posture:** must the application, data pipeline, and generated data packs all be open, or is self-hostability/no proprietary dependency sufficient?
3. **Explicit-content posture:** should the default lexicon include uncensored rap vocabulary with user-controlled filtering, or ship in a filtered state?
4. **Creative scope:** should the first demo stay word/phrase-suggestion only, or may it offer constrained completion such as “fill this one slot” while still avoiding generated bars?

## 27. Prototype verdict

Build the smallest version that can demonstrate this claim:

> Given a line, a sound family chosen by the writer, and an optional meaning target, RhymeGraph finds a varied set of words or phrases that sound right, fit the thought, and reveal productive paths a conventional rhyme list would hide.

If target writers repeatedly retain those suggestions and traverse the space, continue into dialect, phrase, and performed-cadence work. If they only admire the graph and return to another editor, the visual concept has succeeded but the product has not.

## Appendix A — source references for current technical assumptions

- [Transformers.js documentation](https://huggingface.co/docs/transformers.js/main/index): browser ONNX inference, quantization, WebGPU, and WASM fallback.
- [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu): feature extraction and browser speech-recognition examples.
- [`all-MiniLM-L6-v2` model](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2): baseline semantic embedding model; Apache 2.0 licence.
- [CMUdict](https://github.com/cmusphinx/cmudict): initial General American pronunciation source.
- [WordNet](https://wordnet.princeton.edu/): lexical metadata, primary gloss material, and bounded local definitions used through `wordnet-db`.
- [SUBTLEX-US](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus): build-time spoken-frequency coverage and utility, not pronunciation or dialect data.
- [PanPhon](https://github.com/dmort27/panphon): reference for articulatory-feature distance; MIT licence.

These references establish feasibility, not final dependency selection. Every dependency and derived data asset still requires a pinned version and distribution audit before release.
