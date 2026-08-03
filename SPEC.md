# RhymeGraph

## Product and technical specification

| Field | Value |
|---|---|
| Status | Draft v0.2 — ready for product review |
| Working title | RhymeGraph |
| Initial audience | Rappers and lyricists |
| Initial platform | Local-first web application |
| Core promise | Find the next useful word by sound, meaning, and flow—not by spelling |
| Runtime dependency policy | No proprietary dictionary or inference API required |
| Last revised | 2026-08-03 |

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

On small screens, Draft and Explore become two fast-switching views. The graph always has a synchronized ranked-list representation for accessibility and precise scanning.

### Core loop

1. The writer types a line or enters a word.
2. They select a word, syllable span, or phrase as the sound anchor.
3. RhymeGraph immediately shows a phonetic neighbourhood.
4. Semantic results refine when the local embedding worker is ready.
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

### A local, semantic graph

Render approximately 12–24 candidate nodes, the active centre, and at most five pinned anchors. Never render the full lexicon.

The layout must encode something understandable:

- Radius from centre: combined recommendation distance.
- Angular region: dominant relationship family—vowel, ending/coda, rhythm, or semantic bridge.
- Edge width: relationship strength.
- Edge style: solid for high-confidence dictionary pronunciation; dashed for generated or adventurous matches.
- Node size: lexical utility/commonness.
- Node ring: pinned, active, previously visited, or inserted state.

Use a deterministic, seeded layout so nodes do not jump randomly after each rerank. A light collision simulation is acceptable after initial placement; an unconstrained force graph is not.

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

- **Pronunciation:** CMUdict, whose maintainers permit unrestricted research and commercial use and request acknowledgement.
- **Meanings and lexical relations:** Open English WordNet, currently CC BY 4.0.
- **Phonological feature definitions:** an audited internal table, potentially derived from MIT-licensed PanPhon data.
- **Frequency, slang/register, phrases, UK pronunciations, and etymology:** unresolved until source quality and redistribution rights are audited.

Every generated record carries provenance. Data without known redistribution rights does not enter a shipped asset.

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
2. Generate plausible alignment windows around stressed syllables.
3. Align phoneme-feature sequences with weighted insertion, deletion, and substitution costs.
4. Compute separate vowel, coda, consonance, stress, and whole-span scores.
5. Prefer longer coherent matches over isolated coincidental phonemes.
6. Apply dialect-specific equivalence and merger rules.
7. Calibrate scores separately by syllable shape so short words do not dominate unfairly.

The exact cost matrix is a product hypothesis and must be tuned against human judgments. It belongs in versioned data/configuration, not scattered constants.

### Retrieval representation

Detailed alignment is too expensive across the full vocabulary. Generate a compact retrieval signature containing:

- Last stressed vowel and neighbouring vowel trajectory.
- Coda feature summary.
- Final two or three syllable shapes.
- Stress pattern.
- Position-weighted articulatory feature pooling.

This signature retrieves a generous candidate pool. The detailed alignment reranks it. A learned phonetic embedding may later improve recall, but it is not required for the first product.

## 10. Semantic embeddings in the browser

Use `@huggingface/transformers` in a Web Worker. The current baseline is an ONNX-compatible, quantized `sentence-transformers/all-MiniLM-L6-v2`, producing normalized 384-dimensional embeddings. Model choice remains provisional until evaluated on lyric-context retrieval.

### What is embedded

Avoid treating one embedding of an isolated spelling as its permanent meaning. Embed:

- The active line and optional surrounding lines.
- An explicit concept prompt when provided.
- Lexical sense glosses during the offline data build.
- A phrase directly when the user enters one.

Candidate semantic score is the best context-to-sense match, with penalties for a clearly incompatible part of speech or register.

### Distribution strategy

- The application shell and phonetic search work before the model is ready.
- Load semantic inference lazily and show honest progress on first use.
- Use WebGPU when available and verified; fall back to WASM.
- Cache model assets through browser caching/service-worker mechanisms.
- Host pinned model artifacts ourselves in production so the product is not operationally dependent on the Hugging Face Hub.
- Pin model and tokenizer revisions; never silently change embedding space.
- Store precomputed sense embeddings with the same model-version identifier.

### Initial semantic index strategy

Do not embed every candidate during each query. Precompute quantized gloss embeddings and ship them in lexical shards. The browser embeds only the query context, then computes dot products for the phonetic candidate pool. A full semantic approximate-nearest-neighbour index is only needed for Bridge mode if brute-force benchmarks fail.

## 11. Candidate generation and ranking

### Retrieval pipeline

```text
1. Resolve anchor pronunciations for the selected dialect
2. Infer a shared pattern when several anchors are pinned
3. Union candidates from phonetic indexes
4. Add semantic-bridge candidates when requested
5. Apply hard lexical filters
6. Run detailed phonetic alignment
7. Score meaning, stress/cadence, utility, and confidence
8. Fuse calibrated component scores
9. Diversify the visible set
10. Build graph edges and explanations
```

Suggested pool sizes for the first benchmark, not permanent constants:

- Exact/full-tail index: up to 100.
- Related vowel families: up to 300.
- Related coda/consonant families: up to 300.
- Compact phonetic nearest neighbours: up to 500.
- Semantic bridge retrieval: up to 200.
- Detailed rerank pool after deduplication: target 500–1,200.
- Visible result set: 12–24.

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

For several sound anchors:

1. Align their strongest pronunciation spans.
2. Find features shared by all anchors and features shared by a majority.
3. Represent the family as required, preferred, and free phonetic positions.
4. Retrieve against this family signature.
5. Score candidate consistency against every anchor as well as the inferred family.

```text
family_fit(c) =
    0.45 × mean(similarity(c, anchors))
  + 0.25 × min(similarity(c, anchors))
  + 0.30 × inferred_pattern_match(c)
```

These weights are merely an initial experimental configuration. The minimum term prevents a centroid-near candidate that clashes badly with one pinned word from ranking too highly.

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

### Prototype commitment

The first compelling demo includes a **small, licensed phrase pack** and supports user-entered phrases. It does not claim exhaustive phrase search.

Phrase representation concatenates pronunciations while retaining word boundaries. Alignment may cross those boundaries, allowing a single word to match several words. Ranking includes:

- Phonetic span quality.
- Stress and syllable compatibility.
- Phrase frequency/plausibility.
- Semantic fit.
- Boundary awkwardness penalty.

Only attested or deliberately curated phrases are shipped. Arbitrary Cartesian combinations of words are not precomputed.

The phrase source is a launch-blocking data decision because many obvious lyric and n-gram corpora have unsuitable redistribution terms.

## 14. Dialect and pronunciation

Dialect is part of the data model from the first commit even though the initial data pack is General American.

### First release

- Label the initial pronunciation basis clearly.
- Permit alternate pronunciations already present in CMUdict.
- Let users choose among pronunciations for ambiguous words.
- Allow a local pronunciation override using phoneme selection or “sounds like” input.
- Mark G2P results as estimated.

### Later dialect packs

- UK English is the first additional target.
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

## 17. MVP definition

### Included in v0.1

- Desktop-first responsive web application.
- Scratchpad with active-line context and selection.
- 30,000–60,000 useful English words, filtered from a larger pronunciation lexicon.
- General American pronunciation with alternate pronunciation selection.
- Immediate phonetic retrieval and detailed component scoring.
- Browser semantic inference using a pinned quantized embedding model.
- Continue, Bridge, and Pivot intents.
- Multi-pin family inference.
- Local graph plus synchronized ranked list.
- Sound/meaning, adventurousness, rhythm, syllable, part-of-speech, and frequency controls.
- Candidate explanations and pronunciation display.
- Insert, replace, pin, expand, dismiss, backtrack, and undo.
- Local project persistence with no account.
- A small, legally distributable phrase demonstration if the data audit succeeds.

### Deferred

- Comprehensive phrase search.
- UK dialect pack.
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
- At most five pinned sound anchors.
- At most 24 visible candidate nodes.
- No server required for ordinary v0.1 use.

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

## 19. Proposed technical architecture

### Repository shape

```text
rhymegraph/
  apps/
    web/                  # TypeScript UI and browser workers
  packages/
    domain/               # shared types and query contracts
    phonetics/            # alignment, scoring, family inference
    ranking/              # score fusion and diversification
    graph/                # graph projection and stable layout
    data-runtime/         # shard loading, indexes, provenance
  pipeline/
    ingest/               # source-specific importers
    build/                # normalization and asset generation
    evaluate/             # benchmark and ranking reports
  data/
    manifests/            # versions, hashes, licences, attribution
    fixtures/             # small test-only lexical samples
  docs/
    decisions/            # architecture decision records
```

### Initial technology choices

- TypeScript, React, and Vite for the application.
- Plain SVG/DOM graph rendering initially; 30 nodes do not justify a heavy graph engine.
- Web Workers for semantic inference and expensive scoring.
- `@huggingface/transformers` with pinned ONNX model artifacts.
- IndexedDB for drafts, settings, cached derived data, and optional session feedback.
- Python for the offline lexical build/evaluation pipeline because the phonetics/NLP ecosystem is stronger there.
- Vitest for unit/property tests and Playwright for the core interaction script.

These choices are defaults for speed, not permanent commitments. No backend, vector database, or WebGL renderer should be introduced until a measured need exists.

### Runtime flow

```text
static lexical shards ───────┐
phonetic indexes ────────────┼─ phonetic Worker ─ candidates + alignments
query/pins/dialect ──────────┘                         │
                                                      ├─ rank + diversify ─ UI
context/concept ─ embedding Worker ─ semantic scores ─┘
```

Semantic enhancement is progressive. A late semantic response carries a query revision ID and is discarded if the user has already changed the query.

### Versioning

The following identifiers are persisted with a project/search snapshot:

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
- Optional quantized sense vectors/shards: target under 25 MB initial pack.
- Browser memory after model load: target under 350 MB on desktop.

If these budgets cannot be met, reduce vocabulary/sense-pack size or add on-demand shards before introducing a required backend.

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

Label it honestly, model dialect from the start, accept pronunciation overrides, and prioritize a UK pack after the core loop.

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
7. General American is the initial labelled pronunciation pack; the schema is dialect-aware.
8. Multi-pin family inference is MVP, not an enhancement.
9. Phrase support appears in the demo through an audited limited pack, not exhaustive generation.
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
- [Open English WordNet](https://github.com/globalwordnet/english-wordnet): definitions and lexical graph; CC BY 4.0.
- [PanPhon](https://github.com/dmort27/panphon): reference for articulatory-feature distance; MIT licence.

These references establish feasibility, not final dependency selection. Every dependency and derived data asset still requires a pinned version and distribution audit before release.
