import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalCandidateGraph, type LocalGraphCandidate } from "../lib/explorer/local-graph";

const candidates: LocalGraphCandidate[] = [
  ["cavity", "K AE1 V AH0 T IY0", 96, 98],
  ["vanity", "V AE1 N AH0 T IY0", 92, 94],
  ["battery", "B AE1 T ER0 IY0", 88, 90],
  ["strategy", "S T R AE1 T AH0 JH IY0", 82, 84],
  ["galaxy", "G AE1 L AH0 K S IY0", 80, 82],
  ["salary", "S AE1 L ER0 IY0", 78, 80],
  ["rapidly", "R AE1 P AH0 D L IY0", 77, 79],
  ["tragedy", "T R AE1 JH AH0 D IY0", 76, 78],
].map(([word, pronunciation, overall, sound]) => ({
  id: word as string,
  word: word as string,
  pronunciation: pronunciation as string,
  overall: overall as number,
  sound: sound as number,
}));

test("local graph is deterministic and includes genuine neighbour edges", () => {
  const first = buildLocalCandidateGraph(candidates);
  const second = buildLocalCandidateGraph(candidates);
  assert.deepEqual(first, second);
  assert.equal(first.nodes.length, candidates.length);
  assert.ok(first.edges.some((edge) => edge.kind === "neighbour"));
  assert.equal(new Set(first.edges.map((edge) => `${edge.kind}:${edge.source}:${edge.target}`)).size, first.edges.length);
  assert.ok(first.nodes.every((node) => node.x >= 8 && node.x <= 92 && node.y >= 10 && node.y <= 90));
});

test("local graph resolves candidate label rectangles", () => {
  const graph = buildLocalCandidateGraph(candidates);
  for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
    const left = graph.nodes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
      const right = graph.nodes[rightIndex];
      const leftWidth = Math.min(11.5, Math.max(6.2, 5.4 + left.word.length * .34));
      const rightWidth = Math.min(11.5, Math.max(6.2, 5.4 + right.word.length * .34));
      const overlaps =
        Math.abs(right.x - left.x) < leftWidth + rightWidth + 1 &&
        Math.abs(right.y - left.y) < 11;
      assert.equal(overlaps, false, `${left.word} overlaps ${right.word}`);
    }
  }
});
