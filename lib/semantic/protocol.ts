export interface SemanticScore {
  text: string;
  score: number;
}

export interface SemanticIndexSummary {
  schemaVersion: 1;
  model: string;
  lexiconVersion: string;
  count: number;
  dimensions: number;
  calibration: "unrelated-pair-normal-cdf";
}

export interface SemanticRetrievalHit {
  text: string;
  /** Stable corpus-calibrated score in [0, 1], not a relevance probability. */
  score: number;
  /** Fixed corpus-relative strength intended for hybrid score fusion. */
  fusionScore: number;
  /** Approximate raw cosine from the checked-in int8 index. */
  cosine: number;
  partOfSpeechMask: number;
  senseCount: number;
  utility: number;
  flags: number;
  /** Bounded primary WordNet gloss for result inspection, when available. */
  definition?: string;
}

export interface SemanticReadyEvent {
  type: "ready";
  requestId: number;
  model: string;
}

export interface SemanticErrorEvent {
  type: "error";
  requestId: number;
  message: string;
}

export interface SemanticResultEvent {
  type: "result";
  requestId: number;
  scores: SemanticScore[];
}

export interface SemanticRetrievedEvent {
  type: "retrieved";
  requestId: number;
  hits: SemanticRetrievalHit[];
  index: SemanticIndexSummary;
}

export type SemanticWorkerEvent =
  | SemanticReadyEvent
  | SemanticErrorEvent
  | SemanticResultEvent
  | SemanticRetrievedEvent;

export interface SemanticInitRequest {
  type: "init";
  requestId: number;
}

export interface SemanticScoreRequest {
  type: "score";
  requestId: number;
  queryText: string;
  candidates: string[];
}

export interface SemanticRetrieveRequest {
  type: "retrieve";
  requestId: number;
  queryText: string;
  limit?: number;
  exclude?: string[];
}

export type SemanticWorkerRequest =
  | SemanticInitRequest
  | SemanticScoreRequest
  | SemanticRetrieveRequest;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSemanticScore(value: unknown): value is SemanticScore {
  if (typeof value !== "object" || value === null) return false;
  const score = value as Partial<SemanticScore>;
  return typeof score.text === "string" && isFiniteNumber(score.score);
}

function isOptionalDefinition(value: unknown): value is string | undefined {
  return value === undefined ||
    (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 180 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value)
    );
}

function isRetrievalHit(value: unknown): value is SemanticRetrievalHit {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<SemanticRetrievalHit>;
  return (
    typeof hit.text === "string" &&
    isFiniteNumber(hit.score) && hit.score >= 0 && hit.score <= 1 &&
    isFiniteNumber(hit.fusionScore) && hit.fusionScore >= 0 && hit.fusionScore <= 1 &&
    isFiniteNumber(hit.cosine) && hit.cosine >= -1 && hit.cosine <= 1 &&
    isNonNegativeSafeInteger(hit.partOfSpeechMask) &&
    isNonNegativeSafeInteger(hit.senseCount) &&
    isFiniteNumber(hit.utility) && hit.utility >= 0 && hit.utility <= 1 &&
    isNonNegativeSafeInteger(hit.flags) &&
    isOptionalDefinition(hit.definition)
  );
}

function isIndexSummary(value: unknown): value is SemanticIndexSummary {
  if (typeof value !== "object" || value === null) return false;
  const summary = value as Partial<SemanticIndexSummary>;
  return (
    summary.schemaVersion === 1 &&
    typeof summary.model === "string" &&
    typeof summary.lexiconVersion === "string" &&
    Number.isSafeInteger(summary.count) &&
    Number.isSafeInteger(summary.dimensions) &&
    summary.calibration === "unrelated-pair-normal-cdf"
  );
}

export function isSemanticWorkerEvent(value: unknown): value is SemanticWorkerEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SemanticWorkerEvent>;
  if (!Number.isSafeInteger(candidate.requestId) || (candidate.requestId ?? -1) < 0) return false;
  if (candidate.type === "ready") return typeof candidate.model === "string";
  if (candidate.type === "error") return typeof candidate.message === "string";
  if (candidate.type === "result") {
    return Array.isArray(candidate.scores) && candidate.scores.every(isSemanticScore);
  }
  if (candidate.type === "retrieved") {
    return Array.isArray(candidate.hits) && candidate.hits.every(isRetrievalHit) &&
      isIndexSummary(candidate.index);
  }
  return false;
}
