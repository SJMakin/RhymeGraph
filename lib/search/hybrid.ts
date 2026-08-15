import type { RecommendationIntent } from "../phonetics";
import type { SemanticRetrievalHit } from "../semantic/protocol";

export interface HybridSearchPolicy {
  semanticScores: Record<string, number>;
  weights: { sound: number; meaning: number; utility: number };
  minPhonetic: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function normalizeCandidateText(text: string): string {
  return text.toLocaleLowerCase("en").trim().replace(/[’]/g, "'").replace(/\s+/g, " ");
}

/**
 * Converts independently retrieved semantic hits into a late-fusion policy.
 * Fusion strengths use one checked-in corpus background calibration and must
 * never be min/max stretched relative to the current result batch.
 */
export function createHybridSearchPolicy(input: {
  intent: RecommendationIntent;
  meaningMix: number;
  reach: number;
  semanticHits: readonly SemanticRetrievalHit[];
}): HybridSearchPolicy {
  const meaning = clamp01(input.meaningMix / 100);
  const reach = clamp01(input.reach);
  const semanticScores = Object.create(null) as Record<string, number>;
  for (const hit of input.semanticHits) {
    if (!Number.isFinite(hit.fusionScore)) continue;
    const key = normalizeCandidateText(hit.text);
    semanticScores[key] = Math.max(
      semanticScores[key] ?? 0,
      clamp01(hit.fusionScore),
    );
  }

  const minPhoneticBase = input.intent === "continue" ? .32 : input.intent === "bridge" ? .16 : .2;
  const reachReduction = input.intent === "continue" ? .16 : .08;
  return {
    semanticScores,
    weights: {
      sound: Math.max(.08, 1 - meaning),
      meaning,
      utility: .12,
    },
    minPhonetic: Math.max(.08, minPhoneticBase - reach * reachReduction),
  };
}
