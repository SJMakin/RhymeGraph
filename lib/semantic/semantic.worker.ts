import { env, pipeline } from "@huggingface/transformers";
import wasmFactoryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasmBinaryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

import { rankByCosine } from "./cosine";
import { withBasePath } from "../public-path";
import type {
  SemanticProgressEvent,
  SemanticWorkerEvent,
  SemanticWorkerRequest,
} from "./protocol";

const MODEL_ID = "all-MiniLM-L6-v2";
const MODEL_ROOT = withBasePath("/models/");
const EMBEDDING_DIMENSIONS = 384;

type FeatureExtractor = Awaited<ReturnType<typeof createExtractor>>;

interface ProgressUpdate {
  status?: unknown;
  file?: unknown;
  progress?: unknown;
  loaded?: unknown;
  total?: unknown;
}

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
let activeInitRequestId = 0;

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

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emitProgress(update: ProgressUpdate): void {
  const event: SemanticProgressEvent = {
    type: "progress",
    requestId: activeInitRequestId,
    status: typeof update.status === "string" ? update.status : "loading",
    file: typeof update.file === "string" ? update.file : undefined,
    progress: numberOrUndefined(update.progress),
    loaded: numberOrUndefined(update.loaded),
    total: numberOrUndefined(update.total),
  };
  workerScope.postMessage(event);
}

async function createExtractor() {
  return pipeline("feature-extraction", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    local_files_only: true,
    progress_callback: emitProgress,
  });
}

function getExtractor(requestId: number): Promise<FeatureExtractor> {
  activeInitRequestId = requestId;
  extractorPromise ??= createExtractor().catch((error: unknown) => {
    // Permit an explicit retry after a transient local asset/runtime failure.
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
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
  await getExtractor(requestId);
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

  const extractor = await getExtractor(requestId);
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

workerScope.onmessage = (event) => {
  const request = event.data;
  const operation =
    request.type === "init"
      ? initialize(request.requestId)
      : score(request.requestId, request.queryText, request.candidates);

  void operation.catch((error: unknown) => {
    workerScope.postMessage({
      type: "error",
      requestId: request.requestId,
      message: errorMessage(error),
    });
  });
};
