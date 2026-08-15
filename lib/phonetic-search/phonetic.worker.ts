import { createRhymeEngine, type LexiconEntryInput, type RhymeEngine } from "../phonetics";
import { composePerformancePhraseEntries } from "./performance-phrases";
import {
  searchCandidateId,
  type PhoneticWorkerEvent,
  type PhoneticWorkerRequest,
  type SearchCandidate,
} from "./protocol";

interface CompactLexicon {
  version: string;
  entries: Array<[string, string[], number, number, number?, number?]>;
  entryFlags?: {
    wordnet?: number;
    spoken?: number;
    authored?: number;
    slang?: number;
    reference?: number;
    uk?: number;
  };
  phrases: Array<[
    string,
    Array<string | { phonemes: string; wordStarts?: number[] }>,
  ]>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<PhoneticWorkerRequest>) => void) | null;
  postMessage(message: PhoneticWorkerEvent): void;
}

const scope = self as unknown as WorkerScope;
let enginePromise: Promise<{ engine: RhymeEngine; version: string; elapsedMs: number }> | undefined;
const LEXICON_SHA256 = "2e61f5f0633d0ea94dd973ba945641a130217721c25d41194fe8d0487111b26c";
const configuredWorkerBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const workerBasePath = configuredWorkerBasePath
  ? `/${configuredWorkerBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

function withWorkerBasePath(path: string) {
  return `${workerBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}

function utilityFromMetadata(word: string, senses: number): number {
  const senseUtility = Math.min(.95, .35 + Math.log2(1 + Math.max(1, senses)) * .12);
  const lengthPenalty = Math.max(0, word.length - 13) * .012;
  return Math.max(.24, Math.min(.98, senseUtility - lengthPenalty));
}

function tagsFromMask(mask: number): string[] {
  const tags: string[] = [];
  if (mask & 1) tags.push("noun");
  if (mask & 2) tags.push("verb");
  if (mask & 4) tags.push("adjective");
  if (mask & 8) tags.push("adverb");
  return tags;
}

function tagsFromMetadata(
  partOfSpeechMask: number,
  flags: number,
  definitions: CompactLexicon["entryFlags"],
): string[] {
  const tags = tagsFromMask(partOfSpeechMask);
  if (definitions?.spoken && (flags & definitions.spoken) !== 0) tags.push("spoken-corpus");
  if (definitions?.authored && (flags & definitions.authored) !== 0) tags.push("authored-pronunciation");
  if (definitions?.slang && (flags & definitions.slang) !== 0) tags.push("slang");
  if (definitions?.reference && (flags & definitions.reference) !== 0) tags.push("reference");
  if (definitions?.uk && (flags & definitions.uk) !== 0) tags.push("en-GB");
  return tags;
}

function emitProgress(requestId: number, stage: "fetching" | "parsing" | "indexing" | "searching", progress: number) {
  scope.postMessage({ type: "progress", requestId, stage, progress });
}

async function createEngine(requestId: number) {
  const start = performance.now();
  emitProgress(requestId, "fetching", .08);
  const response = await fetch(
    `${withWorkerBasePath("/data/cmudict.compact.json")}?v=${LEXICON_SHA256}`,
  );
  if (!response.ok) throw new Error(`Local pronunciation pack failed to load (${response.status}).`);
  emitProgress(requestId, "parsing", .32);
  const pack = (await response.json()) as CompactLexicon;
  emitProgress(requestId, "indexing", .56);

  const entries: LexiconEntryInput[] = pack.entries.map(
    ([text, pronunciations, partOfSpeechMask, senses, storedUtility, flags = 0]) => ({
      text,
      pronunciations,
      frequency: storedUtility === undefined
        ? utilityFromMetadata(text, senses)
        : Math.max(0, Math.min(1, storedUtility / 1000)),
      tags: tagsFromMetadata(partOfSpeechMask, flags, pack.entryFlags),
    }),
  );
  entries.push(
    ...pack.phrases.filter(([text]) => text.trim().includes(" ")).map(([text, pronunciations]) => ({
      text,
      pronunciations,
      kind: "phrase" as const,
      frequency: .58,
      tags: ["phrase"],
    })),
  );
  entries.push(...composePerformancePhraseEntries(entries));

  const engine = createRhymeEngine(entries);
  return { engine, version: pack.version, elapsedMs: Math.round(performance.now() - start) };
}

async function getEngine(requestId: number) {
  enginePromise ??= createEngine(requestId).catch((error: unknown) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

function score(value: number): number {
  return Math.round(value * 100);
}

function mapCandidate(recommendation: ReturnType<RhymeEngine["recommend"]>[number]): SearchCandidate {
  const pronunciation = recommendation.pronunciation;
  const comparisonReasons = recommendation.anchorComparisons
    .flatMap((comparison) => comparison.explanation)
    .slice(0, 3);
  return {
    id: searchCandidateId(recommendation.item.kind, recommendation.item.normalized),
    word: recommendation.item.text,
    pronunciation: pronunciation.source,
    overall: score(recommendation.score),
    phonetic: score(recommendation.family.phonetic),
    assonance: score(recommendation.family.assonance),
    consonance: score(recommendation.family.consonance),
    coda: score(recommendation.family.coda),
    fullTail: score(recommendation.family.fullTail),
    stress: score(recommendation.family.stress),
    semantic: score(recommendation.semantic),
    utility: score(recommendation.utility),
    syllables: pronunciation.syllableCount,
    labels: [...recommendation.labels],
    reasons: [...new Set([...recommendation.explanation, ...comparisonReasons])].slice(0, 4),
    phrase: recommendation.item.kind === "phrase",
    estimated: recommendation.item.tags.includes("authored-pronunciation"),
    tags: [...recommendation.item.tags],
  };
}

async function init(requestId: number) {
  const value = await getEngine(requestId);
  scope.postMessage({
    type: "ready",
    requestId,
    words: value.engine.items.length,
    version: value.version,
    elapsedMs: value.elapsedMs,
  });
}

async function search(request: Extract<PhoneticWorkerRequest, { type: "search" }>) {
  const { engine } = await getEngine(request.requestId);
  const started = performance.now();
  emitProgress(request.requestId, "searching", .78);
  const recommendations = engine.recommend({
    anchors: request.anchors,
    intent: request.intent,
    semanticScores: request.semanticScores,
    limit: request.limit ?? 60,
    minPhonetic: request.minPhonetic,
    reach: request.reach,
    dialect: request.dialect,
    exclude: request.exclude,
    weights: request.weights,
  });
  scope.postMessage({
    type: "result",
    requestId: request.requestId,
    candidates: recommendations.map(mapCandidate),
    elapsedMs: Math.round(performance.now() - started),
  });
}

scope.onmessage = (event) => {
  const request = event.data;
  const operation = request.type === "init" ? init(request.requestId) : search(request);
  void operation.catch((error: unknown) => {
    scope.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
