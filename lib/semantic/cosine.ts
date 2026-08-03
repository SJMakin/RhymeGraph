export type NumericVector = ArrayLike<number>;

/**
 * Computes cosine similarity without assuming either input is normalized.
 * A zero-length vector has no direction, so its similarity is defined as 0.
 */
export function cosineSimilarity(left: NumericVector, right: NumericVector): number {
  if (left.length !== right.length) {
    throw new RangeError(
      `Cannot compare vectors with different dimensions (${left.length} and ${right.length}).`,
    );
  }

  let dot = 0;
  let leftMagnitudeSquared = 0;
  let rightMagnitudeSquared = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new TypeError("Cosine similarity requires finite vector values.");
    }

    dot += leftValue * rightValue;
    leftMagnitudeSquared += leftValue * leftValue;
    rightMagnitudeSquared += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitudeSquared * rightMagnitudeSquared);
  if (denominator === 0) return 0;

  // Floating point error can put a mathematically normalized dot product a
  // few ulps outside cosine's range.
  return Math.max(-1, Math.min(1, dot / denominator));
}

export function rankByCosine(
  query: NumericVector,
  candidates: readonly { text: string; embedding: NumericVector }[],
): { text: string; score: number }[] {
  return candidates
    .map(({ text, embedding }, sourceIndex) => ({
      text,
      score: cosineSimilarity(query, embedding),
      sourceIndex,
    }))
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map(({ text, score }) => ({ text, score }));
}
