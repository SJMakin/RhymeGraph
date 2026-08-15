import { env, pipeline } from "@huggingface/transformers";
import wasmFactoryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasmBinaryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

import { rankByCosine } from "./cosine";
import {
  loadSemanticIndex,
  searchSemanticIndex,
  sha256ArrayBuffer,
  type LoadedSemanticIndex,
} from "./vector-index";
import type {
  SemanticWorkerEvent,
  SemanticWorkerRequest,
} from "./protocol";

const MODEL_ID = "all-MiniLM-L6-v2";
const configuredWorkerBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const workerBasePath = configuredWorkerBasePath
  ? `/${configuredWorkerBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const withWorkerBasePath = (path: string) =>
  `${workerBasePath}${path.startsWith("/") ? path : `/${path}`}`;
const MODEL_ROOT = withWorkerBasePath("/models/");
const INDEX_MANIFEST_SHA256 = "168d0c07e41daefecdc4f06667c3b349d8474948d890a92bceaee2e45174cecf";
const INDEX_BINARY_SHA256 = "2e48ce37bd70f1b1b4805a915214071ec16fe81a157f861c3621f9526b789d5e";
const INDEX_MANIFEST_URL = `${withWorkerBasePath("/data/semantic-index.v1.json")}?v=${INDEX_MANIFEST_SHA256}`;
const INDEX_BINARY_URL = `${withWorkerBasePath("/data/semantic-index.v1.bin")}?v=${INDEX_BINARY_SHA256}`;
const EMBEDDING_DIMENSIONS = 384;
const MODEL_ASSET_SET_SHA256 = "551f651982a81f63580c48b0fe704b66fab2be32bfd562123ee3bc1636273cd8";

type FeatureExtractor = Awaited<ReturnType<typeof createExtractor>>;

interface EmbeddingTensor {
  data: ArrayLike<number>;
  dims: number[];
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<SemanticWorkerRequest>) => void) | null;
  postMessage(message: SemanticWorkerEvent): void;
}

const workerScope = self as unknown as WorkerScope;
let extractorPromise: Promise<FeatureExtractor> | undefined;
let indexPromise: Promise<LoadedSemanticIndex> | undefined;

// Treat network isolation as a hard requirement rather than a preference.
// If a local asset is absent, initialization fails instead of contacting Hub.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODEL_ROOT;
const wasmBackend = env.backends.onnx.wasm;
if (!wasmBackend) {
  throw new Error("The local ONNX WASM backend is unavailable in this browser.");
}
wasmBackend.numThreads = 1;
wasmBackend.wasmPaths = {
  mjs: wasmFactoryUrl,
  wasm: wasmBinaryUrl,
};

async function createExtractor() {
  return pipeline("feature-extraction", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    local_files_only: true,
  });
}

function getExtractor(): Promise<FeatureExtractor> {
  extractorPromise ??= createExtractor().catch((error: unknown) => {
    // Permit an explicit retry after a transient local asset/runtime failure.
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

async function fetchIndex(): Promise<LoadedSemanticIndex> {
  const [manifestResponse, binaryResponse] = await Promise.all([
    fetch(INDEX_MANIFEST_URL),
    fetch(INDEX_BINARY_URL),
  ]);
  if (!manifestResponse.ok) {
    throw new Error(`Local semantic index manifest failed to load (${manifestResponse.status}).`);
  }
  if (!binaryResponse.ok) {
    throw new Error(`Local semantic index vectors failed to load (${binaryResponse.status}).`);
  }
  const [manifestValue, binary] = await Promise.all([
    manifestResponse.json() as Promise<unknown>,
    binaryResponse.arrayBuffer(),
  ]);
  const index = loadSemanticIndex(manifestValue, binary);
  if (
    index.manifest.index.sha256 !== INDEX_BINARY_SHA256 ||
    await sha256ArrayBuffer(binary) !== index.manifest.index.sha256
  ) {
    throw new Error("Local semantic index vectors failed their integrity check.");
  }
  if (
    index.manifest.model.id !== MODEL_ID ||
    index.manifest.model.dimensions !== EMBEDDING_DIMENSIONS ||
    index.manifest.model.assetSetSha256 !== MODEL_ASSET_SET_SHA256
  ) {
    throw new Error("Local semantic index was built for a different embedding model.");
  }
  return index;
}

function getIndex(): Promise<LoadedSemanticIndex> {
  indexPromise ??= fetchIndex().catch((error: unknown) => {
    // An index failure must not poison candidate-only reranking or an explicit retry.
    indexPromise = undefined;
    throw error;
  });
  return indexPromise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowsFromTensor(tensor: EmbeddingTensor, rowCount: number): Float32Array[] {
  const dimensions = tensor.dims.at(-1) ?? EMBEDDING_DIMENSIONS;
  if (dimensions !== EMBEDDING_DIMENSIONS || tensor.data.length !== rowCount * dimensions) {
    throw new Error(
      `Unexpected embedding shape [${tensor.dims.join(", ")}]; expected ${rowCount} x ${EMBEDDING_DIMENSIONS}.`,
    );
  }

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const offset = rowIndex * dimensions;
    return Float32Array.from(
      { length: dimensions },
      (unused, dimensionIndex) => tensor.data[offset + dimensionIndex],
    );
  });
}

async function initialize(requestId: number): Promise<void> {
  await getExtractor();
  workerScope.postMessage({ type: "ready", requestId, model: MODEL_ID });
}

async function score(
  requestId: number,
  queryText: string,
  candidates: string[],
): Promise<void> {
  if (candidates.length === 0) {
    workerScope.postMessage({ type: "result", requestId, scores: [] });
    return;
  }

  const extractor = await getExtractor();
  const texts = [queryText, ...candidates];
  const output = (await extractor(texts, {
    pooling: "mean",
    normalize: true,
  })) as unknown as EmbeddingTensor;
  const [query, ...candidateEmbeddings] = rowsFromTensor(output, texts.length);
  const scores = rankByCosine(
    query,
    candidates.map((text, index) => ({ text, embedding: candidateEmbeddings[index] })),
  );

  workerScope.postMessage({ type: "result", requestId, scores });
}

async function retrieve(
  requestId: number,
  queryText: string,
  requestedLimit: number | undefined,
  requestedExclude: string[] | undefined,
): Promise<void> {
  const trimmedQuery = queryText.trim();
  if (!trimmedQuery) {
    const index = await getIndex();
    workerScope.postMessage({
      type: "retrieved",
      requestId,
      hits: [],
      index: {
        schemaVersion: 1,
        model: index.manifest.model.id,
        lexiconVersion: index.manifest.source.lexiconVersion,
        count: index.manifest.index.count,
        dimensions: index.manifest.index.dimensions,
        calibration: index.manifest.calibration.kind,
      },
    });
    return;
  }

  const [extractor, index] = await Promise.all([getExtractor(), getIndex()]);
  const output = (await extractor([trimmedQuery], {
    pooling: "mean",
    normalize: true,
  })) as unknown as EmbeddingTensor;
  const [query] = rowsFromTensor(output, 1);
  const limit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
    : 40;
  const exclude = Array.isArray(requestedExclude)
    ? requestedExclude.filter((value) => typeof value === "string").slice(0, 2048)
    : [];
  const hits = searchSemanticIndex(index, query, { limit, exclude });

  workerScope.postMessage({
    type: "retrieved",
    requestId,
    hits,
    index: {
      schemaVersion: 1,
      model: index.manifest.model.id,
      lexiconVersion: index.manifest.source.lexiconVersion,
      count: index.manifest.index.count,
      dimensions: index.manifest.index.dimensions,
      calibration: index.manifest.calibration.kind,
    },
  });
}

workerScope.onmessage = (event) => {
  const request = event.data;
  const operation = request.type === "init"
    ? initialize(request.requestId)
    : request.type === "score"
      ? score(request.requestId, request.queryText, request.candidates)
      : retrieve(
          request.requestId,
          request.queryText,
          request.limit,
          request.exclude,
        );

  void operation.catch((error: unknown) => {
    workerScope.postMessage({
      type: "error",
      requestId: request.requestId,
      message: errorMessage(error),
    });
  });
};
