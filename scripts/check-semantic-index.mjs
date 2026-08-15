import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..", "public", "data");
const MANIFEST_FILE = join(DATA_DIRECTORY, "semantic-index.v1.json");
const BINARY_FILE = join(DATA_DIRECTORY, "semantic-index.v1.bin");
const LEXICON_FILE = join(DATA_DIRECTORY, "cmudict.compact.json");
const MODEL_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..", "public", "models", "all-MiniLM-L6-v2");
const EXPECTED_MODEL_ASSET_FILES = [
  "config.json",
  "onnx/model_quantized.onnx",
  "special_tokens_map.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "vocab.txt",
];
const HEADER_BYTES = 16;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function benchmarkScan(binary, count, dimensions, vectorOffset) {
  const vectors = new Int8Array(binary.buffer, binary.byteOffset + vectorOffset, count * dimensions);
  const query = vectors.subarray(0, dimensions);
  let checksum = 0;
  const timings = [];
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const startedAt = performance.now();
    let best = Number.NEGATIVE_INFINITY;
    for (let row = 0; row < count; row += 1) {
      const offset = row * dimensions;
      let dot = 0;
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        dot += vectors[offset + dimension] * query[dimension];
      }
      if (dot > best) best = dot;
    }
    checksum += best;
    if (iteration > 0) timings.push(performance.now() - startedAt);
  }
  timings.sort((left, right) => left - right);
  assert(Number.isFinite(checksum), "Semantic scan benchmark produced an invalid result.");
  return timings[Math.floor(timings.length / 2)];
}

async function main() {
  const [manifestBytes, binary, lexiconBytes] = await Promise.all([
    readFile(MANIFEST_FILE),
    readFile(BINARY_FILE),
    readFile(LEXICON_FILE),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const count = manifest?.index?.count;
  const dimensions = manifest?.index?.dimensions;
  assert(Number.isSafeInteger(count) && count > 0, "Manifest count is invalid.");
  assert(Number.isSafeInteger(dimensions) && dimensions > 0, "Manifest dimensions are invalid.");
  assert(manifest.entries?.length === count, "Manifest entry count disagrees with index metadata.");
  assert(binary.subarray(0, 4).toString("ascii") === "RGSI", "Binary magic is invalid.");
  assert(binary.readUInt16LE(4) === 1, "Binary format version is invalid.");
  assert(binary.readUInt16LE(6) === dimensions, "Binary dimensions disagree with the manifest.");
  assert(binary.readUInt32LE(8) === count, "Binary count disagrees with the manifest.");
  const vectorOffset = binary.readUInt32LE(12);
  assert(vectorOffset === HEADER_BYTES + count * 4, "Binary vector offset is invalid.");
  assert(binary.length === vectorOffset + count * dimensions, "Binary length is invalid.");
  assert(binary.length === manifest.index.byteLength, "Manifest byte length is invalid.");

  assert(Array.isArray(manifest?.model?.assets), "Manifest model asset list is missing.");
  assert(
    JSON.stringify(manifest.model.assets.map(({ file }) => file)) === JSON.stringify(EXPECTED_MODEL_ASSET_FILES),
    "Manifest model asset list is incomplete or out of order.",
  );
  const modelAssets = await Promise.all(manifest.model.assets.map(async (asset) => {
    assert(
      asset && typeof asset.file === "string" && EXPECTED_MODEL_ASSET_FILES.includes(asset.file),
      "Manifest contains an unsupported model asset path.",
    );
    const bytes = await readFile(join(MODEL_DIRECTORY, ...asset.file.split("/")));
    const assetHash = sha256(bytes);
    assert(bytes.byteLength === asset.byteLength, `${asset.file} byte length disagrees with the manifest.`);
    assert(assetHash === asset.sha256, `${asset.file} SHA-256 disagrees with the manifest.`);
    return { file: asset.file, byteLength: bytes.byteLength, sha256: assetHash };
  }));
  const modelAssetSetHash = sha256(Buffer.from(JSON.stringify(modelAssets)));
  assert(modelAssetSetHash === manifest.model.assetSetSha256, "Model asset-set SHA-256 disagrees with the manifest.");
  assert(
    modelAssets.find(({ file }) => file === "onnx/model_quantized.onnx")?.sha256 === manifest.model.assetSha256,
    "ONNX SHA-256 disagrees with the model asset hash.",
  );

  const binaryHash = sha256(binary);
  const lexiconHash = sha256(lexiconBytes);
  assert(binaryHash === manifest.index.sha256, "Binary SHA-256 disagrees with the manifest.");
  assert(lexiconHash === manifest.source.lexiconSha256, "Index was built from a different lexicon.");

  const scanMilliseconds = benchmarkScan(binary, count, dimensions, vectorOffset);
  console.log(JSON.stringify({
    count,
    dimensions,
    manifestBytes: manifestBytes.length,
    manifestSha256: sha256(manifestBytes),
    binaryBytes: binary.length,
    binarySha256: binaryHash,
    lexiconSha256: lexiconHash,
    modelAssetSetSha256: modelAssetSetHash,
    modelAssets: modelAssets.length,
    medianFullScanMilliseconds: Number(scanMilliseconds.toFixed(2)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
