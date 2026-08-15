import type { PerformanceDialect, RecommendationIntent, RelationshipLabel } from "../phonetics";

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

/**
 * Stable, collision-free identity for a returned lexical item. Keep the exact
 * normalized spelling: punctuation and word boundaries distinguish entries
 * such as `first-class` and the generated phrase `first class`.
 */
export function searchCandidateId(kind: "word" | "phrase", normalized: string) {
  return `${kind}:${normalized}`;
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
      /** Normalized 0..1 exploration distance. Changes ranking, not only cutoff. */
      reach?: number;
      dialect?: PerformanceDialect;
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
