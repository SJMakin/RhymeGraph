import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import { env, pipeline } from "@huggingface/transformers";

const require = createRequire(import.meta.url);
const wordnet = require("wordnet-db");

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DATA_DIRECTORY = join(PROJECT_ROOT, "public", "data");
const LEXICON_FILE = join(DATA_DIRECTORY, "cmudict.compact.json");
const MODEL_DIRECTORY = join(PROJECT_ROOT, "public", "models");
const MODEL_ROOT_DIRECTORY = join(MODEL_DIRECTORY, "all-MiniLM-L6-v2");
const MODEL_ASSET_FILES = [
  "config.json",
  "onnx/model_quantized.onnx",
  "special_tokens_map.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "vocab.txt",
];
const OUTPUT_MANIFEST = join(DATA_DIRECTORY, "semantic-index.v1.json");
const OUTPUT_BINARY = join(DATA_DIRECTORY, "semantic-index.v1.bin");
const TEMP_MANIFEST = `${OUTPUT_MANIFEST}.tmp`;
const TEMP_BINARY = `${OUTPUT_BINARY}.tmp`;

const MODEL_ID = "all-MiniLM-L6-v2";
const DIMENSIONS = 384;
const BATCH_SIZE = 128;
// A short common-sense document is both more discriminative and much cheaper
// to embed than concatenating every meaning of a polysemous word. WordNet index
// offsets are ordered with the most frequent sense first.
const MAX_SENSES = 2;
const MAX_SYNONYMS = 6;
const MAX_DOCUMENT_CHARACTERS = 420;
const MAX_DEFINITION_CHARACTERS = 180;
const DOCUMENT_RECIPE = "wordnet-primary-gloss-pos-synonyms-v1";
const CALIBRATION_SAMPLE_COUNT = 50_000;
const CALIBRATION_SEED = 0x5247594d;
const HEADER_BYTES = 16;
const METADATA_ONLY = process.argv.includes("--metadata-only");

const PARTS_OF_SPEECH = [
  { file: "noun", code: "n", mask: 1, label: "noun" },
  { file: "verb", code: "v", mask: 2, label: "verb" },
  { file: "adj", code: "a", mask: 4, label: "adjective" },
  { file: "adv", code: "r", mask: 8, label: "adverb" },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLemma(value) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\([ap]\)$/i, "");
}

function parseIndexLine(line) {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 6) return undefined;
  const pointerCount = Number(fields[3]);
  const senseCountIndex = 4 + pointerCount;
  const synsetCount = Number(fields[2]);
  const offsetStart = senseCountIndex + 2;
  if (!Number.isSafeInteger(pointerCount) || !Number.isSafeInteger(synsetCount)) return undefined;
  const offsets = fields.slice(offsetStart, offsetStart + synsetCount);
  if (offsets.length !== synsetCount || offsets.some((offset) => !/^\d{8}$/.test(offset))) return undefined;
  return { lemma: normalizeLemma(fields[0]), offsets };
}

function parseDataLine(line) {
  const separator = line.indexOf("|");
  if (separator < 0) return undefined;
  const fields = line.slice(0, separator).trim().split(/\s+/);
  if (fields.length < 6 || !/^\d{8}$/.test(fields[0])) return undefined;
  const wordCount = Number.parseInt(fields[3], 16);
  if (!Number.isSafeInteger(wordCount) || wordCount < 1) return undefined;
  const words = [];
  for (let index = 0; index < wordCount; index += 1) {
    const word = fields[4 + index * 2];
    if (!word) return undefined;
    words.push(normalizeLemma(word));
  }
  const gloss = line.slice(separator + 1).replace(/\s+/g, " ").trim();
  return { offset: fields[0], words, gloss };
}

async function readWordNetMetadata(targetTerms) {
  const offsetsByTermAndPart = new Map();
  const wantedOffsetsByPart = new Map();

  for (const part of PARTS_OF_SPEECH) {
    const wantedOffsets = new Set();
    const contents = await readFile(join(wordnet.path, `index.${part.file}`), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || /^\s/.test(line)) continue;
      const parsed = parseIndexLine(line);
      if (!parsed || !targetTerms.has(parsed.lemma)) continue;
      const offsets = parsed.offsets.slice(0, MAX_SENSES);
      offsetsByTermAndPart.set(`${part.code}:${parsed.lemma}`, offsets);
      offsets.forEach((offset) => wantedOffsets.add(offset));
    }
    wantedOffsetsByPart.set(part.code, wantedOffsets);
  }

  const synsets = new Map();
  for (const part of PARTS_OF_SPEECH) {
    const wantedOffsets = wantedOffsetsByPart.get(part.code);
    const contents = await readFile(join(wordnet.path, `data.${part.file}`), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      if (!line || /^\s/.test(line)) continue;
      const offset = line.slice(0, 8);
      if (!wantedOffsets.has(offset)) continue;
      const parsed = parseDataLine(line);
      if (parsed) synsets.set(`${part.code}:${parsed.offset}`, parsed);
    }
  }

  return { offsetsByTermAndPart, synsets };
}

function fallbackUtilityMilli(word, senses) {
  const senseUtility = Math.min(.95, .35 + Math.log2(1 + Math.max(1, senses)) * .12);
  const lengthPenalty = Math.max(0, word.length - 13) * .012;
  return Math.round(Math.max(.24, Math.min(.98, senseUtility - lengthPenalty)) * 1000);
}

function boundedInteger(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function buildDocument(entry, metadata) {
  const { text, partOfSpeechMask } = entry;
  const labels = PARTS_OF_SPEECH
    .filter((part) => (partOfSpeechMask & part.mask) !== 0)
    .map((part) => part.label);
  const glosses = [];
  const synonyms = [];

  for (const part of PARTS_OF_SPEECH) {
    if (partOfSpeechMask !== 0 && (partOfSpeechMask & part.mask) === 0) continue;
    const offsets = metadata.offsetsByTermAndPart.get(`${part.code}:${text}`) ?? [];
    for (const offset of offsets) {
      const synset = metadata.synsets.get(`${part.code}:${offset}`);
      if (!synset) continue;
      if (synset.gloss && !glosses.includes(synset.gloss)) glosses.push(synset.gloss);
      for (const synonym of synset.words) {
        if (synonym !== text && !synonyms.includes(synonym)) synonyms.push(synonym);
      }
      if (glosses.length >= MAX_SENSES) break;
    }
    if (glosses.length >= MAX_SENSES) break;
  }

  const sections = [text];
  if (labels.length > 0) sections.push(labels.join(", "));
  if (glosses.length > 0) sections.push(glosses.slice(0, MAX_SENSES).join("; "));
  if (synonyms.length > 0) sections.push(`related words: ${synonyms.slice(0, MAX_SYNONYMS).join(", ")}`);
  if (sections.length === 1) sections.push(entry.phrase ? "English phrase" : "spoken English word");
  return sections.join(". ").slice(0, MAX_DOCUMENT_CHARACTERS);
}

function primaryDefinition(entry, metadata) {
  for (const part of PARTS_OF_SPEECH) {
    if (entry.partOfSpeechMask !== 0 && (entry.partOfSpeechMask & part.mask) === 0) continue;
    const [offset] = metadata.offsetsByTermAndPart.get(`${part.code}:${entry.text}`) ?? [];
    const gloss = offset ? metadata.synsets.get(`${part.code}:${offset}`)?.gloss : undefined;
    if (!gloss) continue;
    // WordNet separates usage examples with a semicolon followed by a quote.
    // The primary definition is enough to explain the semantic edge in the UI.
    return gloss
      .split(/;\s*"/, 1)[0]
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_DEFINITION_CHARACTERS)
      .trim();
  }
  return undefined;
}

function serializedEntries(entries, definitions) {
  return entries.map((entry, index) => {
    const tuple = [
      entry.text,
      entry.partOfSpeechMask,
      entry.senseCount,
      entry.utilityMilli,
      entry.flags,
    ];
    if (definitions[index]) tuple.push(definitions[index]);
    return tuple;
  });
}

function rowsFromTensor(tensor, rowCount) {
  const dimensions = tensor.dims.at(-1);
  if (dimensions !== DIMENSIONS || tensor.data.length !== rowCount * DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape [${tensor.dims.join(", ")}]; expected ${rowCount} x ${DIMENSIONS}.`,
    );
  }
  return tensor.data;
}

function quantizeRow(source, sourceOffset, target, targetOffset) {
  let maximumAbsolute = 0;
  for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
    maximumAbsolute = Math.max(maximumAbsolute, Math.abs(source[sourceOffset + dimension]));
  }
  if (!(maximumAbsolute > 0)) throw new Error("Embedding model produced a zero vector.");
  const multiplier = 127 / maximumAbsolute;
  let squaredNorm = 0;
  for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
    const value = Math.max(-127, Math.min(127, Math.round(source[sourceOffset + dimension] * multiplier)));
    target[targetOffset + dimension] = value;
    squaredNorm += value * value;
  }
  return 1 / Math.sqrt(squaredNorm);
}

function indexedCosine(vectors, inverseNorms, left, right) {
  const leftOffset = left * DIMENSIONS;
  const rightOffset = right * DIMENSIONS;
  let dot = 0;
  for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
    dot += vectors[leftOffset + dimension] * vectors[rightOffset + dimension];
  }
  return dot * inverseNorms[left] * inverseNorms[right];
}

function calibrationFromPairs(vectors, inverseNorms, count) {
  let state = CALIBRATION_SEED;
  const nextIndex = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % count;
  };
  let mean = 0;
  let sumSquaredDelta = 0;
  let samples = 0;
  while (samples < CALIBRATION_SAMPLE_COUNT) {
    const left = nextIndex();
    const right = nextIndex();
    if (left === right) continue;
    const value = indexedCosine(vectors, inverseNorms, left, right);
    samples += 1;
    const delta = value - mean;
    mean += delta / samples;
    sumSquaredDelta += delta * (value - mean);
  }
  return {
    kind: "unrelated-pair-normal-cdf",
    mean,
    standardDeviation: Math.sqrt(sumSquaredDelta / (samples - 1)),
    sampleCount: samples,
    seed: CALIBRATION_SEED,
  };
}

function createBinary(vectors, inverseNorms, count) {
  const vectorOffset = HEADER_BYTES + count * Float32Array.BYTES_PER_ELEMENT;
  const output = Buffer.allocUnsafe(vectorOffset + vectors.byteLength);
  output.write("RGSI", 0, 4, "ascii");
  output.writeUInt16LE(1, 4);
  output.writeUInt16LE(DIMENSIONS, 6);
  output.writeUInt32LE(count, 8);
  output.writeUInt32LE(vectorOffset, 12);
  for (let index = 0; index < count; index += 1) {
    output.writeFloatLE(inverseNorms[index], HEADER_BYTES + index * Float32Array.BYTES_PER_ELEMENT);
  }
  Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).copy(output, vectorOffset);
  return output;
}

async function main() {
  const lexiconBytes = await readFile(LEXICON_FILE);
  const pack = JSON.parse(lexiconBytes.toString("utf8"));
  if (!Array.isArray(pack.entries) || !Array.isArray(pack.phrases) || typeof pack.version !== "string") {
    throw new Error("Local pronunciation pack has an unsupported shape.");
  }

  const entries = pack.entries.map((tuple) => {
    if (!Array.isArray(tuple) || typeof tuple[0] !== "string") {
      throw new Error("Local pronunciation pack contains an invalid entry.");
    }
    const text = normalizeLemma(tuple[0]);
    const senseCount = boundedInteger(tuple[3], 1, 0, 10_000);
    return {
      text,
      partOfSpeechMask: boundedInteger(tuple[2], 0, 0, 15),
      senseCount,
      utilityMilli: boundedInteger(tuple[4], fallbackUtilityMilli(text, senseCount), 0, 1000),
      flags: boundedInteger(tuple[5], 0, 0, 0xffff_ffff),
      phrase: false,
    };
  });
  for (const phraseTuple of pack.phrases) {
    if (!Array.isArray(phraseTuple) || typeof phraseTuple[0] !== "string") continue;
    entries.push({
      text: normalizeLemma(phraseTuple[0]),
      partOfSpeechMask: 0,
      senseCount: 0,
      utilityMilli: 580,
      flags: 0,
      phrase: true,
    });
  }

  const seen = new Set();
  const uniqueEntries = entries.filter((entry) => {
    if (!entry.text || seen.has(entry.text)) return false;
    seen.add(entry.text);
    return true;
  });
  const targetTerms = new Set(uniqueEntries.map((entry) => entry.text));
  console.log(`Preparing WordNet metadata for ${uniqueEntries.length.toLocaleString()} entries.`);
  const metadata = await readWordNetMetadata(targetTerms);
  const documents = uniqueEntries.map((entry) => buildDocument(entry, metadata));
  const definitions = uniqueEntries.map((entry) => primaryDefinition(entry, metadata));
  const manifestEntries = serializedEntries(uniqueEntries, definitions);
  const documentsHash = createHash("sha256");
  for (const document of documents) documentsHash.update(document).update("\0");
  const documentsSha256 = documentsHash.digest("hex");
  const modelAssets = await Promise.all(MODEL_ASSET_FILES.map(async (file) => {
    const bytes = await readFile(join(MODEL_ROOT_DIRECTORY, ...file.split("/")));
    return { file, byteLength: bytes.byteLength, sha256: sha256(bytes) };
  }));
  const modelAssetSetSha256 = sha256(Buffer.from(JSON.stringify(modelAssets)));
  const modelAssetSha256 = modelAssets.find(({ file }) => file === "onnx/model_quantized.onnx")?.sha256;
  if (!modelAssetSha256) throw new Error("Semantic model asset manifest omitted the ONNX model.");

  if (METADATA_ONLY) {
    const [existingManifestBytes, binary] = await Promise.all([
      readFile(OUTPUT_MANIFEST),
      readFile(OUTPUT_BINARY),
    ]);
    const existingManifest = JSON.parse(existingManifestBytes.toString("utf8"));
    if (
      existingManifest?.schemaVersion !== 1 ||
      existingManifest?.model?.assetSha256 !== modelAssetSha256 ||
      existingManifest?.source?.lexiconSha256 !== sha256(lexiconBytes) ||
      existingManifest?.source?.documentRecipe !== DOCUMENT_RECIPE ||
      existingManifest?.source?.documentsSha256 !== documentsSha256 ||
      existingManifest?.index?.count !== uniqueEntries.length ||
      existingManifest?.index?.byteLength !== binary.byteLength ||
      existingManifest?.index?.sha256 !== sha256(binary) ||
      !Array.isArray(existingManifest.entries) ||
      existingManifest.entries.length !== uniqueEntries.length ||
      existingManifest.entries.some((entry, index) => entry?.[0] !== uniqueEntries[index]?.text)
    ) {
      throw new Error("Existing semantic index is not compatible with metadata-only enrichment.");
    }

    const enrichedManifestBytes = Buffer.from(`${JSON.stringify({
      ...existingManifest,
      model: {
        ...existingManifest.model,
        assetSha256: modelAssetSha256,
        assetSetSha256: modelAssetSetSha256,
        assets: modelAssets,
      },
      entries: manifestEntries,
    })}\n`);
    await writeFile(TEMP_MANIFEST, enrichedManifestBytes);
    await rm(OUTPUT_MANIFEST, { force: true });
    await rename(TEMP_MANIFEST, OUTPUT_MANIFEST);
    console.log(JSON.stringify({
      definitions: definitions.filter(Boolean).length,
      beforeBytes: existingManifestBytes.byteLength,
      afterBytes: enrichedManifestBytes.byteLength,
      beforeSha256: sha256(existingManifestBytes),
      afterSha256: sha256(enrichedManifestBytes),
      binarySha256: existingManifest.index.sha256,
      documentsSha256,
    }, null, 2));
    return;
  }

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = `${MODEL_DIRECTORY}${process.platform === "win32" ? "\\" : "/"}`;
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    dtype: "q8",
    local_files_only: true,
  });

  const count = uniqueEntries.length;
  const vectors = new Int8Array(count * DIMENSIONS);
  const inverseNorms = new Float32Array(count);
  const startedAt = performance.now();
  for (let start = 0; start < count; start += BATCH_SIZE) {
    const batch = documents.slice(start, Math.min(count, start + BATCH_SIZE));
    const tensor = await extractor(batch, { pooling: "mean", normalize: true });
    const values = rowsFromTensor(tensor, batch.length);
    for (let row = 0; row < batch.length; row += 1) {
      const entryIndex = start + row;
      inverseNorms[entryIndex] = quantizeRow(
        values,
        row * DIMENSIONS,
        vectors,
        entryIndex * DIMENSIONS,
      );
    }
    const completed = Math.min(count, start + batch.length);
    if (completed === count || Math.floor(start / BATCH_SIZE) % 20 === 0) {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      console.log(
        `Embedded ${completed.toLocaleString()}/${count.toLocaleString()} ` +
        `(${Math.round(completed / count * 100)}%, ${elapsedSeconds.toFixed(1)}s).`,
      );
    }
  }

  const calibration = calibrationFromPairs(vectors, inverseNorms, count);
  const binary = createBinary(vectors, inverseNorms, count);
  const manifest = {
    schemaVersion: 1,
    model: {
      id: MODEL_ID,
      dimensions: DIMENSIONS,
      pooling: "mean",
      normalized: true,
      dtype: "q8",
      assetSha256: modelAssetSha256,
      assetSetSha256: modelAssetSetSha256,
      assets: modelAssets,
    },
    source: {
      lexiconVersion: pack.version,
      lexiconSha256: sha256(lexiconBytes),
      wordnetVersion: `${wordnet.version} (wordnet-db@${wordnet.libVersion})`,
      documentRecipe: DOCUMENT_RECIPE,
      documentsSha256,
    },
    index: {
      file: "semantic-index.v1.bin",
      format: "rhymegraph-int8-cosine-v1",
      count,
      dimensions: DIMENSIONS,
      byteLength: binary.byteLength,
      sha256: sha256(binary),
    },
    calibration,
    entries: manifestEntries,
  };

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(TEMP_BINARY, binary),
    writeFile(TEMP_MANIFEST, `${JSON.stringify(manifest)}\n`),
  ]);
  await rm(OUTPUT_BINARY, { force: true });
  await rm(OUTPUT_MANIFEST, { force: true });
  await rename(TEMP_BINARY, OUTPUT_BINARY);
  await rename(TEMP_MANIFEST, OUTPUT_MANIFEST);
  console.log(
    `Wrote ${count.toLocaleString()} vectors: ${binary.byteLength.toLocaleString()} binary bytes; ` +
    `calibration mean ${calibration.mean.toFixed(6)}, SD ${calibration.standardDeviation.toFixed(6)}.`,
  );
}

main().catch(async (error) => {
  await Promise.all([rm(TEMP_BINARY, { force: true }), rm(TEMP_MANIFEST, { force: true })]);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
