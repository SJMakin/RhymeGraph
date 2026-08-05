# RhymeGraph

RhymeGraph is a local-first writing instrument for exploring rhyme as a neighbourhood rather than a lookup table. It combines stress-aware phonetic matching, assonance, consonance, slant rhyme, cadence, multi-word phrases, and optional semantic similarity in an interactive graph.

Nothing typed into the studio is sent to a rhyme service. The pronunciation lexicon, search worker, MiniLM model, and inference runtime are shipped with the app and run in the browser.

**[Open the live studio](https://sjmakin.github.io/RhymeGraph/)**

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

## Useful commands

```bash
npm run data:build   # rebuild the compact, browser-ready pronunciation lexicon
npm run workers:build
npm test             # phonetic and semantic unit tests
npm run test:site    # production build plus end-to-end browser checks
npm run test:pages   # GitHub Pages subpath build plus the same browser checks
npm run lint
```

## How the search works

- A phonetic worker loads the compact CMU pronunciation data and scores candidates with stress-aware sequence alignment.
- Separate vowel, consonant, coda, tail, and cadence signals allow loose relationships to surface without collapsing everything into noise.
- Continue, Bridge, and Pivot intents adjust ranking for direct continuation, semantic movement, or surprising sound-adjacent ideas.
- Up to five pinned anchors describe a rhyme family instead of forcing every search through one word.
- A locally bundled `all-MiniLM-L6-v2` model can rerank candidates by meaning. If it cannot initialize, the studio stays fully usable in sound-only mode.

## Interaction

- Select a word in the draft, or place the caret inside it, to make it the anchor.
- Click a result to inspect why it fits; double-click a graph node or press `E` to traverse from it.
- Press `P` to pin the selected word, `I` to insert it, and `Ctrl/Cmd+Z` to undo the last insertion.
- Use Bridge with a concept such as “escape” or “home” to blend phonetic and semantic fit.

## Current limits

- The pronunciation pack is labelled General American (`en-US`); it is not a universal model of English or rap dialects.
- The shipped phrase pack has eight authored examples. Unknown single words are reported rather than assigned a guessed pronunciation.
- The semantic path currently starts automatically and transfers roughly 46 MiB of uncompressed model/runtime assets, or about 47 MiB including the lexicon. Sound results remain available if it fails.
- The graph is a stable projection of the current ranked neighbourhood, not yet a corpus-wide embedding cluster map.

See the [product and technical specification](./SPEC.md), [implementation status](./docs/STATUS.md), [implementation diary](./docs/IMPLEMENTATION_DIARY.md), and [evidence-led roadmap](./docs/ROADMAP.md). Data and model attribution is recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
