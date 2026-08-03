export interface SemanticScore {
  text: string;
  score: number;
}

export interface SemanticProgressEvent {
  type: "progress";
  requestId: number;
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
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

export type SemanticWorkerEvent =
  | SemanticProgressEvent
  | SemanticReadyEvent
  | SemanticErrorEvent
  | SemanticResultEvent;

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

export type SemanticWorkerRequest = SemanticInitRequest | SemanticScoreRequest;

export function isSemanticWorkerEvent(value: unknown): value is SemanticWorkerEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SemanticWorkerEvent>;
  return (
    typeof candidate.type === "string" &&
    ["progress", "ready", "error", "result"].includes(candidate.type) &&
    typeof candidate.requestId === "number"
  );
}
