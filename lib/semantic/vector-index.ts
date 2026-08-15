const INDEX_MAGIC = "RGSI";
const INDEX_FORMAT_VERSION = 1;
const INDEX_HEADER_BYTES = 16;
const MAX_RETRIEVAL_LIMIT = 200;
const MAX_DEFINITION_CHARACTERS = 180;

export interface SemanticIndexEntry {
  text: string;
  partOfSpeechMask: number;
  senseCount: number;
  utilityMilli: number;
  flags: number;
  definition?: string;
}

export interface SemanticIndexCalibration {
  kind: "unrelated-pair-normal-cdf";
  mean: number;
  standardDeviation: number;
  sampleCount: number;
  seed: number;
}

export interface SemanticIndexManifest {
  schemaVersion: 1;
  model: {
    id: string;
    dimensions: number;
    pooling: "mean";
    normalized: true;
    dtype: "q8";
    assetSha256: string;
    assetSetSha256: string;
    assets: Array<{
      file: string;
      byteLength: number;
      sha256: string;
    }>;
  };
  source: {
    lexiconVersion: string;
    lexiconSha256: string;
    wordnetVersion: string;
    documentRecipe: string;
    documentsSha256: string;
  };
  index: {
    file: "semantic-index.v1.bin";
    format: "rhymegraph-int8-cosine-v1";
    count: number;
    dimensions: number;
    byteLength: number;
    sha256: string;
  };
  calibration: SemanticIndexCalibration;
  entries: SemanticIndexEntry[];
}

export interface LoadedSemanticIndex {
  manifest: SemanticIndexManifest;
  inverseNorms: Float32Array;
  vectors: Int8Array;
}

export interface SemanticIndexHit {
  text: string;
  /** Stable corpus-calibrated score. This is not a human relevance probability. */
  score: number;
  /** Stable fusion strength: null mean maps to 0 and mean + 4 SD maps to 1. */
  fusionScore: number;
  /** Approximate raw cosine from the int8 index, preserved for evaluation. */
  cosine: number;
  partOfSpeechMask: number;
  senseCount: number;
  utility: number;
  flags: number;
  /** Bounded primary WordNet gloss explaining the indexed sense, when known. */
  definition?: string;
}

export async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface HeapCandidate {
  cosine: number;
  sourceIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Semantic index ${label} must be a finite number.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RangeError(`Semantic index ${label} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Semantic index ${label} must be a non-empty string.`);
  }
  return value;
}

function sha256String(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new TypeError(`Semantic index ${label} must be a lowercase SHA-256 digest.`);
  }
  return parsed;
}

function optionalDefinition(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DEFINITION_CHARACTERS ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value)
  ) {
    throw new TypeError(
      `Semantic index ${label} must be a trimmed, control-free string of at most ${MAX_DEFINITION_CHARACTERS} characters.`,
    );
  }
  return value;
}

export function parseSemanticIndexManifest(value: unknown): SemanticIndexManifest {
  if (!isRecord(value)) throw new TypeError("Semantic index manifest must be an object.");
  if (value.schemaVersion !== 1) throw new Error("Unsupported semantic index manifest version.");
  if (!isRecord(value.model) || !isRecord(value.source) || !isRecord(value.index)) {
    throw new TypeError("Semantic index manifest is missing model, source, or index metadata.");
  }
  if (!isRecord(value.calibration) || !Array.isArray(value.entries)) {
    throw new TypeError("Semantic index manifest is missing calibration or entries.");
  }

  const dimensions = integer(value.index.dimensions, "dimensions", 1);
  const count = integer(value.index.count, "entry count", 1);
  if (integer(value.model.dimensions, "model dimensions", 1) !== dimensions) {
    throw new Error("Semantic index model and vector dimensions disagree.");
  }
  if (value.model.pooling !== "mean" || value.model.normalized !== true || value.model.dtype !== "q8") {
    throw new Error("Semantic index model recipe is unsupported.");
  }
  if (!Array.isArray(value.model.assets) || value.model.assets.length === 0) {
    throw new TypeError("Semantic index model assets must be a non-empty array.");
  }
  const assetFiles = new Set<string>();
  const assets = value.model.assets.map((asset, assetIndex) => {
    if (!isRecord(asset)) throw new TypeError(`Semantic index model asset ${assetIndex} must be an object.`);
    const file = nonEmptyString(asset.file, `model asset ${assetIndex} file`);
    if (
      file.startsWith("/") ||
      file.includes("\\") ||
      file.split("/").some((part) => part === "" || part === "." || part === "..") ||
      assetFiles.has(file)
    ) {
      throw new TypeError(`Semantic index model asset ${assetIndex} has an unsafe or duplicate file path.`);
    }
    assetFiles.add(file);
    return {
      file,
      byteLength: integer(asset.byteLength, `model asset ${assetIndex} byte length`, 1),
      sha256: sha256String(asset.sha256, `model asset ${assetIndex} hash`),
    };
  });
  if (value.index.file !== "semantic-index.v1.bin" || value.index.format !== "rhymegraph-int8-cosine-v1") {
    throw new Error("Semantic index binary format is unsupported.");
  }
  if (value.calibration.kind !== "unrelated-pair-normal-cdf") {
    throw new Error("Semantic index calibration is unsupported.");
  }

  const standardDeviation = finiteNumber(
    value.calibration.standardDeviation,
    "calibration standard deviation",
  );
  if (standardDeviation <= 0) {
    throw new RangeError("Semantic index calibration standard deviation must be positive.");
  }

  const entries = value.entries.map((entry, entryIndex): SemanticIndexEntry => {
    if (!Array.isArray(entry) || ![3, 5, 6].includes(entry.length)) {
      throw new TypeError(`Semantic index entry ${entryIndex} must be a three-, five-, or six-item tuple.`);
    }
    const utilityMilli = entry.length >= 5
      ? integer(entry[3], `entry ${entryIndex} utility`, 0)
      : 0;
    if (utilityMilli > 1000) throw new RangeError(`Semantic index entry ${entryIndex} utility exceeds 1000.`);
    return {
      text: nonEmptyString(entry[0], `entry ${entryIndex} text`),
      partOfSpeechMask: integer(entry[1], `entry ${entryIndex} part-of-speech mask`),
      senseCount: integer(entry[2], `entry ${entryIndex} sense count`),
      utilityMilli,
      flags: entry.length >= 5 ? integer(entry[4], `entry ${entryIndex} flags`, 0) : 0,
      definition: entry.length === 6
        ? optionalDefinition(entry[5], `entry ${entryIndex} definition`)
        : undefined,
    };
  });
  if (entries.length !== count) throw new Error("Semantic index entry count does not match its metadata.");

  return {
    schemaVersion: 1,
    model: {
      id: nonEmptyString(value.model.id, "model id"),
      dimensions,
      pooling: "mean",
      normalized: true,
      dtype: "q8",
      assetSha256: sha256String(value.model.assetSha256, "model hash"),
      assetSetSha256: sha256String(value.model.assetSetSha256, "model asset-set hash"),
      assets,
    },
    source: {
      lexiconVersion: nonEmptyString(value.source.lexiconVersion, "lexicon version"),
      lexiconSha256: nonEmptyString(value.source.lexiconSha256, "lexicon hash"),
      wordnetVersion: nonEmptyString(value.source.wordnetVersion, "WordNet version"),
      documentRecipe: nonEmptyString(value.source.documentRecipe, "document recipe"),
      documentsSha256: nonEmptyString(value.source.documentsSha256, "documents hash"),
    },
    index: {
      file: "semantic-index.v1.bin",
      format: "rhymegraph-int8-cosine-v1",
      count,
      dimensions,
      byteLength: integer(value.index.byteLength, "byte length", INDEX_HEADER_BYTES),
      sha256: nonEmptyString(value.index.sha256, "binary hash"),
    },
    calibration: {
      kind: "unrelated-pair-normal-cdf",
      mean: finiteNumber(value.calibration.mean, "calibration mean"),
      standardDeviation,
      sampleCount: integer(value.calibration.sampleCount, "calibration sample count", 2),
      seed: integer(value.calibration.seed, "calibration seed"),
    },
    entries,
  };
}

export function loadSemanticIndex(
  manifestValue: unknown,
  binary: ArrayBuffer,
): LoadedSemanticIndex {
  const manifest = parseSemanticIndexManifest(manifestValue);
  if (binary.byteLength !== manifest.index.byteLength) {
    throw new Error("Semantic index binary length does not match its manifest.");
  }
  if (binary.byteLength < INDEX_HEADER_BYTES) throw new Error("Semantic index binary is truncated.");

  const bytes = new Uint8Array(binary);
  const magic = String.fromCharCode(...bytes.subarray(0, INDEX_MAGIC.length));
  const header = new DataView(binary, 0, INDEX_HEADER_BYTES);
  const version = header.getUint16(4, true);
  const dimensions = header.getUint16(6, true);
  const count = header.getUint32(8, true);
  const vectorOffset = header.getUint32(12, true);
  const expectedVectorOffset = INDEX_HEADER_BYTES + count * Float32Array.BYTES_PER_ELEMENT;
  const expectedLength = expectedVectorOffset + count * dimensions;

  if (magic !== INDEX_MAGIC || version !== INDEX_FORMAT_VERSION) {
    throw new Error("Semantic index binary header is unsupported.");
  }
  if (dimensions !== manifest.index.dimensions || count !== manifest.index.count) {
    throw new Error("Semantic index binary and manifest dimensions disagree.");
  }
  if (vectorOffset !== expectedVectorOffset || binary.byteLength !== expectedLength) {
    throw new Error("Semantic index binary layout is invalid.");
  }

  const inverseNorms = new Float32Array(count);
  const normsView = new DataView(binary, INDEX_HEADER_BYTES, count * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < count; index += 1) {
    const inverseNorm = normsView.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
    if (!Number.isFinite(inverseNorm) || inverseNorm <= 0) {
      throw new Error(`Semantic index inverse norm ${index} is invalid.`);
    }
    inverseNorms[index] = inverseNorm;
  }

  return {
    manifest,
    inverseNorms,
    vectors: new Int8Array(binary, vectorOffset, count * dimensions),
  };
}

export function normalizeSemanticTerm(text: string): string {
  return text.toLocaleLowerCase("en").trim().replace(/[’]/g, "'").replace(/\s+/g, " ");
}

// Abramowitz and Stegun 7.1.26. It is sufficiently accurate for a stable,
// corpus-level display transform; raw cosine remains available to evaluators.
function standardNormalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-(x * x)));
  return Math.max(0, Math.min(1, (1 + erf) / 2));
}

export function calibrateSemanticCosine(
  cosine: number,
  calibration: SemanticIndexCalibration,
): number {
  if (!Number.isFinite(cosine)) throw new TypeError("Semantic cosine must be finite.");
  const zScore = (cosine - calibration.mean) / calibration.standardDeviation;
  return standardNormalCdf(zScore);
}

export function semanticFusionScore(
  cosine: number,
  calibration: SemanticIndexCalibration,
): number {
  if (!Number.isFinite(cosine)) throw new TypeError("Semantic cosine must be finite.");
  const fourSigma = calibration.standardDeviation * 4;
  return Math.max(0, Math.min(1, (cosine - calibration.mean) / fourSigma));
}

function isWorse(left: HeapCandidate, right: HeapCandidate): boolean {
  return left.cosine < right.cosine ||
    (left.cosine === right.cosine && left.sourceIndex > right.sourceIndex);
}

function siftUp(heap: HeapCandidate[], sourceIndex: number): void {
  let index = sourceIndex;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isWorse(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function siftDown(heap: HeapCandidate[], sourceIndex: number): void {
  let index = sourceIndex;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    if (worst === index) break;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

export function searchSemanticIndex(
  index: LoadedSemanticIndex,
  query: ArrayLike<number>,
  options: { limit?: number; exclude?: readonly string[] } = {},
): SemanticIndexHit[] {
  const { dimensions, count } = index.manifest.index;
  if (query.length !== dimensions) {
    throw new RangeError(`Semantic query has ${query.length} dimensions; expected ${dimensions}.`);
  }
  let queryNormSquared = 0;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const value = query[dimension];
    if (!Number.isFinite(value)) throw new TypeError("Semantic query vector must contain finite values.");
    queryNormSquared += value * value;
  }
  const queryNorm = Math.sqrt(queryNormSquared);
  if (queryNorm === 0) return [];

  const requestedLimit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : 40;
  const limit = Math.min(MAX_RETRIEVAL_LIMIT, Math.max(1, requestedLimit));
  // Terms emitted by the builder are already normalized. Normalize only the
  // small caller-owned exclusion list, not all 54k index terms on every scan.
  const excluded = options.exclude?.length
    ? new Set(options.exclude.map(normalizeSemanticTerm))
    : undefined;
  const heap: HeapCandidate[] = [];

  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entry = index.manifest.entries[entryIndex];
    if (excluded?.has(entry.text)) continue;
    const offset = entryIndex * dimensions;
    let dot = 0;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      dot += index.vectors[offset + dimension] * query[dimension];
    }
    const cosine = Math.max(
      -1,
      Math.min(1, dot * index.inverseNorms[entryIndex] / queryNorm),
    );
    const candidate: HeapCandidate = {
      cosine,
      sourceIndex: entryIndex,
    };

    if (heap.length < limit) {
      heap.push(candidate);
      siftUp(heap, heap.length - 1);
    } else if (isWorse(heap[0], candidate)) {
      heap[0] = candidate;
      siftDown(heap, 0);
    }
  }

  return heap
    .sort((left, right) => right.cosine - left.cosine || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex, cosine }) => {
      const entry = index.manifest.entries[sourceIndex];
      return {
        text: entry.text,
        score: calibrateSemanticCosine(cosine, index.manifest.calibration),
        fusionScore: semanticFusionScore(cosine, index.manifest.calibration),
        cosine,
        partOfSpeechMask: entry.partOfSpeechMask,
        senseCount: entry.senseCount,
        utility: entry.utilityMilli / 1000,
        flags: entry.flags,
        definition: entry.definition,
      };
    });
}
