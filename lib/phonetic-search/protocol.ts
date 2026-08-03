import type { RecommendationIntent, RelationshipLabel } from "../phonetics";

export interface SearchCandidate {
  id: string;
  word: string;
  pronunciation: string;
  overall: number;
  phonetic: number;
  assonance: number;
  consonance: number;
  coda: number;
  fullTail: number;
  stress: number;
  semantic: number;
  utility: number;
  syllables: number;
  labels: RelationshipLabel[];
  reasons: string[];
  phrase: boolean;
  estimated: boolean;
  tags: string[];
}

export type PhoneticWorkerRequest =
  | { type: "init"; requestId: number }
  | {
      type: "search";
      requestId: number;
      anchors: string[];
      intent: RecommendationIntent;
      semanticScores?: Record<string, number>;
      limit?: number;
      minPhonetic?: number;
      exclude?: string[];
      weights?: { sound?: number; meaning?: number; utility?: number };
    };

export type PhoneticWorkerEvent =
  | {
      type: "progress";
      requestId: number;
      stage: "fetching" | "parsing" | "indexing" | "searching";
      progress: number;
    }
  | {
      type: "ready";
      requestId: number;
      words: number;
      version: string;
      elapsedMs: number;
    }
  | {
      type: "result";
      requestId: number;
      candidates: SearchCandidate[];
      elapsedMs: number;
    }
  | { type: "error"; requestId: number; message: string };

export function isPhoneticWorkerEvent(value: unknown): value is PhoneticWorkerEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "progress" || type === "ready" || type === "result" || type === "error";
}
