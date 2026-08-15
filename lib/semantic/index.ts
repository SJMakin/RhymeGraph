export { createSemanticClient, SemanticClient, SemanticRequestSupersededError } from "./client";
export { cosineSimilarity, rankByCosine } from "./cosine";
export {
  calibrateSemanticCosine,
  loadSemanticIndex,
  normalizeSemanticTerm,
  parseSemanticIndexManifest,
  searchSemanticIndex,
  semanticFusionScore,
} from "./vector-index";
export type {
  LoadedSemanticIndex,
  SemanticIndexCalibration,
  SemanticIndexEntry,
  SemanticIndexHit,
  SemanticIndexManifest,
} from "./vector-index";
export type {
  SemanticErrorEvent,
  SemanticIndexSummary,
  SemanticReadyEvent,
  SemanticRetrievalHit,
  SemanticRetrievedEvent,
  SemanticScore,
  SemanticWorkerEvent,
} from "./protocol";
