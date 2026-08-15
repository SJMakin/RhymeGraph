# Third-party data and model notices

RhymeGraph's local prototype ships the following redistributable resources.

Complete licence texts are included in `public/licenses/` and are available
from the in-product `/notices` page. Links below identify the corresponding
upstream projects; they are not substitutes for the bundled terms.

## CMU Pronouncing Dictionary

The local English pronunciation data is obtained through
`cmu-pronouncing-dictionary@3.0.0`, which is distributed under the ISC licence
and sourced from the Carnegie Mellon University Pronouncing Dictionary.

The npm wrapper is ISC licensed. The CMU dictionary itself is redistributed
under Carnegie Mellon University's upstream licence and attribution terms.

- Source: https://github.com/cmusphinx/cmudict
- Package: https://github.com/words/cmu-pronouncing-dictionary

## all-MiniLM-L6-v2

The browser-local semantic model is `sentence-transformers/all-MiniLM-L6-v2`,
converted to ONNX by Xenova. It embeds the writer's query on device and is also
used at build time to create RhymeGraph's int8 word-document index. The model
is distributed under Apache License 2.0. The vendored model revision is
`826711e54e001c83835913827a843d8dd0a1def9`.

- ONNX SHA-256: `AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1`
- Semantic index binary SHA-256: `2E48CE37BD70F1B1B4805A915214071EC16FE81A157F861C3621F9526B789D5E`
- Semantic index manifest SHA-256: `168D0C07E41DAEFECDC4F06667C3B349D8474948D890A92BCEAEE2E45174CECF`
- Six-file model/tokenizer/config/vocabulary asset-set SHA-256: `551F651982A81F63580C48B0FE704B66FAB2BE32BFD562123EE3BC1636273CD8`

The semantic index binary is 21,006,336 bytes and its integrity-enriched
manifest is 3,386,621 bytes. The complete optional semantic path—including a
versioned worker, runtime, WASM, six checked model files, and the index—is about
69.10 MiB raw. Its exact file total differs between root and Pages exports
because the versioned worker embeds the deployment base path. This is an asset
estimate, not a measured wire-transfer or memory figure.

- Model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- ONNX conversion: https://huggingface.co/Xenova/all-MiniLM-L6-v2

## WordNet 3.1

WordNet 3.1 indexes and data files are used during the builds to label lexical
entries, count senses, assemble bounded primary-gloss/POS/synonym documents,
and retain a bounded primary definition when available. The shipped assets
contain derived metadata, definitions, and vectors rather than the original
WordNet database files.

- Source: https://wordnet.princeton.edu/
- Build package: https://github.com/moos/wordnet-db

## SUBTLEX word frequencies

`subtlex-word-frequencies@2.0.0` supplies spoken-English frequency counts used
at build time to retain common inflections and colloquial forms and to rank
everyday vocabulary ahead of dictionary artefacts. The package is ISC licensed
and derives its counts from the 51-million-word SUBTLEX-US subtitle corpus.
The shipped lexicon stores only a normalized utility value per entry. SUBTLEX-US
is not used as pronunciation data, a British-English source, or a rap/style
corpus.

- Package: https://github.com/words/subtlex-word-frequencies
- Corpus information: https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus

## RhymeGraph-authored language additions

RhymeGraph adds a small transparent set of slang/reference pronunciations,
eight compact-pack phrase fixtures, and 151 ordinary performance-phrase
building blocks whose pronunciations are composed from the word lexicon at
runtime. These additions were authored for the project. They are not extracted
from lyrics, an artist catalogue, a commercial rhyme dictionary, or an n-gram
corpus.

## Transformers.js and ONNX Runtime Web

Browser inference uses `@huggingface/transformers` and ONNX Runtime Web. Local
runtime assets are included so ordinary semantic inference does not require a
third-party network request.

- Transformers.js: `4.2.0`, Apache License 2.0
- ONNX Runtime Web: `1.26.0-dev.20260416-b7804b056c`, MIT
- WASM SHA-256: `E0C0C6D3E73D43B8A249972F8358F845B08CC16FEC3C80EFAFDF8BED40366786`
- The complete ONNX Runtime third-party notice bundle is included unchanged.

- Transformers.js: https://github.com/huggingface/transformers.js
- ONNX Runtime: https://github.com/microsoft/onnxruntime

## Static application runtime

The shipped browser interface includes React, React DOM, Next.js, and Lucide
icons. The semantic-worker bundle also includes the MIT-licensed
`@huggingface/jinja` parser used by Transformers.js. Copyright notices and the
applicable MIT/ISC licence texts, including the Feather-derived Lucide notice,
are bundled in `public/licenses/Web-Runtime-Licences.txt` and linked from the
in-product notices page.

- React / React DOM: `19.2.6`, MIT
- Next.js: `16.3.0`, MIT
- Lucide React: `1.28.0`, ISC with Feather MIT notice
- `@huggingface/jinja`: bundled by Transformers.js, MIT
