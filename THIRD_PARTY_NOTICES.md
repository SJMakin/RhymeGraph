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
converted to ONNX by Xenova. The model is distributed under Apache License 2.0.
The vendored model revision is `826711e54e001c83835913827a843d8dd0a1def9`.

- ONNX SHA-256: `AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1`

- Model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- ONNX conversion: https://huggingface.co/Xenova/all-MiniLM-L6-v2

## WordNet 3.1

WordNet lemma and part-of-speech indexes are used during the data build to
filter corpus-specific names and artefacts from the pronunciation vocabulary.
The runtime pack stores only derived lemma metadata, not the original database
files.

- Source: https://wordnet.princeton.edu/
- Build package: https://github.com/moos/wordnet-db

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
