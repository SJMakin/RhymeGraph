import { createRhymeEngine } from "../phonetics";

export interface LocalGraphCandidate {
  id: string;
  word: string;
  pronunciation: string;
  overall: number;
  sound: number;
}

export interface LocalGraphNode extends LocalGraphCandidate {
  x: number;
  y: number;
}

export interface LocalGraphEdge {
  source: string;
  target: string;
  weight: number;
  kind: "anchor" | "neighbour";
}

export interface LocalCandidateGraph {
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
}

interface MutablePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function hashAngle(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 3600) / 10;
}

function orderedPair(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function labelHalfWidth(word: string): number {
  return clamp(5.4 + word.length * .34, 6.2, 11.5);
}

/**
 * Builds a small, deterministic phonetic kNN graph for the visible result set.
 * The graph deliberately does not infer candidate-to-candidate semantics from
 * their independent query scores; every neighbour edge is backed by an actual
 * pronunciation comparison.
 */
export function buildLocalCandidateGraph(
  candidates: readonly LocalGraphCandidate[],
  options: { neighboursPerNode?: number; minimumEdge?: number } = {},
): LocalCandidateGraph {
  if (candidates.length === 0) return { nodes: [], edges: [] };
  const neighboursPerNode = clamp(Math.trunc(options.neighboursPerNode ?? 2), 1, 4);
  const minimumEdge = clamp(options.minimumEdge ?? .38, 0, 1);
  const engine = createRhymeEngine(candidates.map((candidate) => ({
    text: candidate.word,
    pronunciations: [candidate.pronunciation],
  })));

  const similarities = new Map<string, number>();
  const rankedNeighbours = new Map<string, Array<{ id: string; weight: number }>>();
  for (const candidate of candidates) rankedNeighbours.set(candidate.id, []);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      const comparison = engine.compare(left.word, right.word);
      const weight = comparison?.components.phonetic ?? 0;
      similarities.set(orderedPair(left.id, right.id), weight);
      rankedNeighbours.get(left.id)!.push({ id: right.id, weight });
      rankedNeighbours.get(right.id)!.push({ id: left.id, weight });
    }
  }

  const selectedPairs = new Set<string>();
  for (const candidate of candidates) {
    const neighbours = rankedNeighbours.get(candidate.id)!;
    neighbours.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    const useful = neighbours.filter((neighbour) => neighbour.weight >= minimumEdge);
    const selected = (useful.length > 0 ? useful : neighbours.slice(0, 1)).slice(0, neighboursPerNode);
    for (const neighbour of selected) selectedPairs.add(orderedPair(candidate.id, neighbour.id));
  }

  const neighbourEdges = [...selectedPairs]
    .map((pair): LocalGraphEdge => {
      const [source, target] = pair.split("\u0000");
      return {
        source,
        target,
        weight: similarities.get(pair) ?? 0,
        kind: "neighbour",
      };
    })
    .sort((left, right) => right.weight - left.weight || left.source.localeCompare(right.source));

  const anchorEdges = candidates.map((candidate): LocalGraphEdge => ({
    source: "__anchor__",
    target: candidate.id,
    weight: clamp(candidate.sound / 100, 0, 1),
    kind: "anchor",
  }));

  const points = new Map<string, MutablePoint>();
  for (const candidate of candidates) {
    const angle = hashAngle(candidate.id) * Math.PI / 180;
    const radius = 21 + (100 - clamp(candidate.sound, 0, 100)) * .17;
    points.set(candidate.id, {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius * .72,
      vx: 0,
      vy: 0,
    });
  }

  // A bounded force pass gives real neighbours a local visual relationship.
  // Fixed iteration count and hash seeds keep positions stable across reloads.
  for (let iteration = 0; iteration < 84; iteration += 1) {
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      const left = candidates[leftIndex];
      const leftPoint = points.get(left.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const right = candidates[rightIndex];
        const rightPoint = points.get(right.id)!;
        let dx = rightPoint.x - leftPoint.x;
        let dy = rightPoint.y - leftPoint.y;
        const distance = Math.max(1.2, Math.hypot(dx, dy));
        dx /= distance;
        dy /= distance;
        const repel = 1.55 / Math.max(1, distance * .15);
        leftPoint.vx -= dx * repel;
        leftPoint.vy -= dy * repel;
        rightPoint.vx += dx * repel;
        rightPoint.vy += dy * repel;
      }
    }

    for (const edge of neighbourEdges) {
      const source = points.get(edge.source)!;
      const target = points.get(edge.target)!;
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      dx /= distance;
      dy /= distance;
      const targetDistance = 12 + (1 - edge.weight) * 15;
      const force = (distance - targetDistance) * (.012 + edge.weight * .018);
      source.vx += dx * force;
      source.vy += dy * force;
      target.vx -= dx * force;
      target.vy -= dy * force;
    }

    for (const candidate of candidates) {
      const point = points.get(candidate.id)!;
      const dx = point.x - 50;
      const dy = point.y - 50;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const targetRadius = 21 + (100 - clamp(candidate.sound, 0, 100)) * .17;
      const radial = (targetRadius - distance) * .018;
      point.vx += dx / distance * radial;
      point.vy += dy / distance * radial;
      point.vx *= .62;
      point.vy *= .62;
      point.x = clamp(point.x + point.vx, 8, 92);
      point.y = clamp(point.y + point.vy, 10, 90);
    }
  }

  // Resolve label rectangles after the force pass. This favours readability
  // over pretending that a few pixels of mathematical precision are useful.
  for (let pass = 0; pass < 28; pass += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      const left = candidates[leftIndex];
      const leftPoint = points.get(left.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const right = candidates[rightIndex];
        const rightPoint = points.get(right.id)!;
        const overlapX = labelHalfWidth(left.word) + labelHalfWidth(right.word) + 1.2 -
          Math.abs(rightPoint.x - leftPoint.x);
        const overlapY = 5.2 + 5.2 + 1.2 - Math.abs(rightPoint.y - leftPoint.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const direction = rightPoint.x >= leftPoint.x ? 1 : -1;
          const shift = overlapX / 2 + .15;
          leftPoint.x = clamp(leftPoint.x - direction * shift, 8, 92);
          rightPoint.x = clamp(rightPoint.x + direction * shift, 8, 92);
        } else {
          const direction = rightPoint.y >= leftPoint.y ? 1 : -1;
          const shift = overlapY / 2 + .15;
          leftPoint.y = clamp(leftPoint.y - direction * shift, 10, 90);
          rightPoint.y = clamp(rightPoint.y + direction * shift, 10, 90);
        }
      }
    }
    if (!moved) break;
  }

  return {
    nodes: candidates.map((candidate) => ({
      ...candidate,
      x: Math.round(points.get(candidate.id)!.x * 1000) / 1000,
      y: Math.round(points.get(candidate.id)!.y * 1000) / 1000,
    })),
    edges: [...anchorEdges, ...neighbourEdges],
  };
}
