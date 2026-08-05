# RhymeGraph implementation status

This is the compact source of truth for what v0.1 actually ships. [SPEC.md](../SPEC.md) records the original product and technical design; the [implementation diary](./IMPLEMENTATION_DIARY.md) explains the decisions and discoveries that produced the current vertical slice.

| Capability | Status | v0.1 evidence | Next gate |
| --- | --- | --- | --- |
| Local-first static application | Shipped | Static Next export; same-origin runtime assets; no service API | Preserve in production browser tests |
| Stress-aware loose-rhyme scoring | Shipped | Assonance, consonance, coda, tail, stress, mosaic, and false-positive tests | Golden-set preference over suffix baseline |
| Multi-pin family search | Shipped | Up to five anchors; one consistent candidate pronunciation across the family | Blinded comparison with best single anchor |
| Continue / Bridge / Pivot | Shipped | Deterministic intent-aware engine and UI paths | Target writers understand and use the distinction |
| Pronunciation vocabulary | Partial | 35,510 `en-US` entries, 39,175 pronunciations, curated slang overrides | Measured OOV coverage and reviewed dialect expansion |
| Phrase and mosaic search | Partial | Word-boundary-aware composition and 8 authored fixtures | Audited redistributable phrase source or user-local phrases |
| Indexed retrieval | Deferred | Current worker scans the full lexicon and returns up to 72 candidates | Equivalent accepted pool with materially lower p95 latency |
| Local semantic ranking | Shipped, progressive | q8 MiniLM, 384 dimensions, single-thread WASM, remote models disabled | Measured quality/latency/payload comparison with alternatives |
| Whole-vocabulary/sense embeddings | Deferred | Current worker embeds the query and phonetic candidate set at request time | Only add if evaluation shows candidate generation needs semantics |
| Interactive graph | Shipped, simplified | Stable on-demand star neighbourhood with graph/list traversal | Graph v2 outperforms current graph/list in writing sessions |
| Candidate-to-candidate embedding graph | Deferred | No global clusters or candidate similarity edges in v0.1 | Local k-nearest-neighbour prototype over top candidates |
| Draft workflow and persistence | Shipped | Selection anchor, insert, expand, pin, single-step insertion undo, traversal breadcrumbs, local restoration | Import/export, real draft history, and longer repeat-use sessions |
| Responsive interaction | Shipped for tested widths | Browser checks at desktop, tablet, and phone widths | Wider real-device and browser matrix |
| Accessibility | Partial | Semantic controls, keyboard actions, focus and responsive fallbacks | WCAG AA, screen-reader, reduced-motion, and WebKit audit |
| Failure isolation | Shipped | Sound-only fallback; stale requests superseded; OOV clears results | Browser tests for corrupt/missing assets and retry behaviour |
| Runtime privacy | Shipped for v0.1 | Remote model access is disabled; the core-loop browser test detects external requests and fails on them | Extend the assertion to every scenario; decide research-data policy separately |
| Offline-after-first-load guarantee | Deferred | Assets are static/local-origin, but no service worker is shipped | Versioned-cache PWA experiment with update testing |
| Evaluation harness | Deferred | Focused regression fixtures only; no representative golden set | v0.2 Evidence milestone |
| Target-writer validation | Deferred | No structured target-writer study yet | Focused sessions using local research export |
| Dialect packs and local G2P | Deferred | Pack is explicitly labelled `en-US`; no guessed OOV pronunciation | Audited profile and blinded pronunciation review |
| STT, cadence, and TTS | Deferred | UI language only hints at future performed-cadence work | Timing features beat text-stress baseline before product work |
| Etymology/knowledge layers | Deferred | Basic POS and sense-count metadata only | Licensed, payload-audited optional pack |
| GitHub Pages release | Shipped | CI tests the root export; the deployment workflow separately tests the `/RhymeGraph` export | Test both paths on pull requests; add cache/version discipline |

## Known measurements

| Artifact or sample | Current observation |
| --- | --- |
| Lexicon JSON | 1,494,652 bytes |
| Quantized ONNX model | 22,972,370 bytes |
| ONNX WASM binary | 23,567,050 bytes |
| Root static export | 52,632,125 bytes across 53 files |
| Pages static export | 52,636,911 bytes across 53 files |
| Automated tests | 18 unit/data cases and 4 Chromium end-to-end scenarios |
| Cold live sample | DOM 3.23 s; sound 4.21 s; semantics 8.75 s; reranked result 10.39 s |
| Warm live sample | DOM 0.06 s; sound 0.56 s; semantics 2.82 s; reranked result 5.20 s |
| 24-case Node sound diagnostic | Init 371 ms / +33.6 MiB heap; search median 291 ms; p95 859 ms; max 1,793 ms (five pins) |

The timing rows are one Chromium observation and one Node diagnostic on a development machine. They are included to seed repeatable benchmarking, not to imply a supported device-wide budget.
