import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { cosineSimilarity, rankByCosine } from "../lib/semantic/cosine.ts";

test("cosine similarity identifies equal, perpendicular and opposite vectors", () => {
  assert.equal(cosineSimilarity([2, 0], [10, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-3, 0]), -1);
});

test("cosine similarity handles typed and zero vectors", () => {
  const score = cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]));
  assert.ok(Math.abs(score - 1) < Number.EPSILON);
  assert.equal(cosineSimilarity([0, 0], [4, 8]), 0);
});

test("cosine similarity rejects invalid vectors", () => {
  assert.throws(() => cosineSimilarity([1], [1, 2]), RangeError);
  assert.throws(() => cosineSimilarity([1, Number.NaN], [1, 2]), TypeError);
});

test("rankByCosine ranks descending and keeps input order for ties", () => {
  assert.deepEqual(
    rankByCosine([1, 0], [
      { text: "sideways-a", embedding: [0, 1] },
      { text: "same", embedding: [1, 0] },
      { text: "sideways-b", embedding: [0, -1] },
    ]),
    [
      { text: "same", score: 1 },
      { text: "sideways-a", score: 0 },
      { text: "sideways-b", score: 0 },
    ],
  );
});
