import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { cosineSimilarity, rankByCosine } from "../lib/semantic/cosine.ts";
// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { SemanticClient, SemanticRequestSupersededError } from "../lib/semantic/client.ts";
// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { isSemanticWorkerEvent } from "../lib/semantic/protocol.ts";
// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { calibrateSemanticCosine, loadSemanticIndex, searchSemanticIndex, semanticFusionScore, sha256ArrayBuffer } from "../lib/semantic/vector-index.ts";
import type {
  SemanticWorkerEvent,
  SemanticWorkerRequest,
} from "../lib/semantic/protocol.ts";

class FakeSemanticWorker {
  readonly requests: SemanticWorkerRequest[] = [];
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as EventListener;
    if (type === "message") this.messageListeners.add(callback);
    if (type === "error") this.errorListeners.add(callback);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as EventListener;
    if (type === "message") this.messageListeners.delete(callback);
    if (type === "error") this.errorListeners.delete(callback);
  }

  postMessage(request: SemanticWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {}

  emit(event: SemanticWorkerEvent) {
    const message = new MessageEvent("message", { data: event });
    this.messageListeners.forEach((listener) => listener(message));
  }
}

function semanticFixture() {
  const dimensions = 2;
  const count = 3;
  const vectorOffset = 16 + count * Float32Array.BYTES_PER_ELEMENT;
  const binary = new ArrayBuffer(vectorOffset + count * dimensions);
  const header = new DataView(binary);
  new Uint8Array(binary, 0, 4).set([0x52, 0x47, 0x53, 0x49]); // RGSI
  header.setUint16(4, 1, true);
  header.setUint16(6, dimensions, true);
  header.setUint32(8, count, true);
  header.setUint32(12, vectorOffset, true);

  const vectors = [127, 0, 0, 127, 100, 10];
  const inverseNorms = [1 / 127, 1 / 127, 1 / Math.hypot(100, 10)];
  inverseNorms.forEach((inverseNorm, index) => {
    header.setFloat32(16 + index * Float32Array.BYTES_PER_ELEMENT, inverseNorm, true);
  });
  new Int8Array(binary, vectorOffset).set(vectors);

  return {
    binary,
    manifest: {
      schemaVersion: 1,
      model: {
        id: "test-model",
        dimensions,
        pooling: "mean",
        normalized: true,
        dtype: "q8",
        assetSha256: "a".repeat(64),
        assetSetSha256: "b".repeat(64),
        assets: [{ file: "tokenizer.json", byteLength: 10, sha256: "c".repeat(64) }],
      },
      source: {
        lexiconVersion: "test-lexicon",
        lexiconSha256: "lexicon-hash",
        wordnetVersion: "test-wordnet",
        documentRecipe: "test-recipe",
        documentsSha256: "documents-hash",
      },
      index: {
        file: "semantic-index.v1.bin",
        format: "rhymegraph-int8-cosine-v1",
        count,
        dimensions,
        byteLength: binary.byteLength,
        sha256: "binary-hash",
      },
      calibration: {
        kind: "unrelated-pair-normal-cdf",
        mean: 0,
        standardDeviation: 1,
        sampleCount: 100,
        seed: 1,
      },
      entries: [
        ["money", 1, 2, 900, 3],
        ["love", 2, 3, 800, 1],
        ["cash", 1, 1, 850, 3, "money in coins or notes"],
      ],
    },
  };
}

test("cosine similarity identifies equal, perpendicular and opposite vectors", () => {
  assert.equal(cosineSimilarity([2, 0], [10, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-3, 0]), -1);
});

test("semantic binary hashing is deterministic", async () => {
  const value = new TextEncoder().encode("abc");
  assert.equal(
    await sha256ArrayBuffer(value.buffer),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
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

test("whole-vocabulary search preserves raw cosine, calibration and metadata", () => {
  const fixture = semanticFixture();
  const index = loadSemanticIndex(fixture.manifest, fixture.binary);
  const hits = searchSemanticIndex(index, [1, 0], { limit: 2, exclude: [" MONEY "] });

  assert.deepEqual(hits.map((hit) => hit.text), ["cash", "love"]);
  assert.ok(Math.abs(hits[0].cosine - 100 / Math.hypot(100, 10)) < 1e-6);
  assert.equal(hits[0].score, calibrateSemanticCosine(hits[0].cosine, index.manifest.calibration));
  assert.equal(
    hits[0].fusionScore,
    semanticFusionScore(hits[0].cosine, index.manifest.calibration),
  );
  assert.deepEqual(
    {
      partOfSpeechMask: hits[0].partOfSpeechMask,
      senseCount: hits[0].senseCount,
      utility: hits[0].utility,
      flags: hits[0].flags,
      definition: hits[0].definition,
    },
    {
      partOfSpeechMask: 1,
      senseCount: 1,
      utility: 0.85,
      flags: 3,
      definition: "money in coins or notes",
    },
  );
});

test("semantic index loader rejects a corrupt binary layout", () => {
  const fixture = semanticFixture();
  new DataView(fixture.binary).setUint32(12, 16, true);
  assert.throws(() => loadSemanticIndex(fixture.manifest, fixture.binary), /layout is invalid/);
});

test("semantic index manifest rejects unsafe or unbounded definitions", () => {
  const tooLong = semanticFixture();
  tooLong.manifest.entries[2][5] = "x".repeat(181);
  assert.throws(() => loadSemanticIndex(tooLong.manifest, tooLong.binary), /definition/);

  const controlCharacter = semanticFixture();
  controlCharacter.manifest.entries[2][5] = "unsafe\u202edefinition";
  assert.throws(() => loadSemanticIndex(controlCharacter.manifest, controlCharacter.binary), /definition/);
});

test("fusion strength has fixed corpus-relative anchors", () => {
  const calibration = {
    kind: "unrelated-pair-normal-cdf" as const,
    mean: 0.2,
    standardDeviation: 0.1,
    sampleCount: 100,
    seed: 1,
  };
  assert.equal(semanticFusionScore(0.2, calibration), 0);
  assert.ok(Math.abs(semanticFusionScore(0.4, calibration) - 0.5) < Number.EPSILON);
  assert.ok(Math.abs(semanticFusionScore(0.6, calibration) - 1) < Number.EPSILON);
  assert.equal(semanticFusionScore(-1, calibration), 0);
});

test("semantic protocol rejects malformed retrieved events", () => {
  assert.equal(isSemanticWorkerEvent({
    type: "retrieved",
    requestId: 1,
    hits: [{ text: "cash", score: 2, cosine: 0.9 }],
    index: {},
  }), false);

  const event = {
    type: "retrieved",
    requestId: 1,
    hits: [{
      text: "cash",
      score: 0.9,
      fusionScore: 0.65,
      cosine: 0.7,
      partOfSpeechMask: 1,
      senseCount: 1,
      utility: 0.8,
      flags: 0,
      definition: "x".repeat(181),
    }],
    index: {
      schemaVersion: 1,
      model: "test-model",
      lexiconVersion: "test-lexicon",
      count: 3,
      dimensions: 2,
      calibration: "unrelated-pair-normal-cdf",
    },
  } as const;
  assert.equal(isSemanticWorkerEvent(event), false);
  assert.equal(isSemanticWorkerEvent({
    ...event,
    hits: [{ ...event.hits[0], definition: "unsafe\ntext" }],
  }), false);
});

test("semantic clients expose whole-vocabulary retrieval and exclusions", async () => {
  const worker = new FakeSemanticWorker();
  const client = new SemanticClient(worker as unknown as Worker);
  const retrieval = client.retrieve("luxury wine", { limit: 24, exclude: ["malbec"] });
  const initRequest = worker.requests[0];
  const request = worker.requests.at(-1)!;
  assert.equal(initRequest.type, "init");
  assert.deepEqual(request, {
    type: "retrieve",
    requestId: request.requestId,
    queryText: "luxury wine",
    limit: 24,
    exclude: ["malbec"],
  });

  worker.emit({ type: "ready", requestId: initRequest.requestId, model: "test-model" });
  worker.emit({
    type: "retrieved",
    requestId: request.requestId,
    hits: [{
      text: "champagne",
      score: 0.91,
      fusionScore: 0.72,
      cosine: 0.72,
      partOfSpeechMask: 1,
      senseCount: 2,
      utility: 0.7,
      flags: 1,
      definition: "sparkling wine from Champagne",
    }],
    index: {
      schemaVersion: 1,
      model: "test-model",
      lexiconVersion: "test-lexicon",
      count: 3,
      dimensions: 2,
      calibration: "unrelated-pair-normal-cdf",
    },
  });
  const result = await retrieval;
  assert.equal(result.hits[0].text, "champagne");
  assert.equal(result.index.count, 3);
  client.dispose();
});

test("semantic clients ignore terminal events from superseded score requests", async () => {
  const worker = new FakeSemanticWorker();
  const client = new SemanticClient(worker as unknown as Worker);
  const observed: SemanticWorkerEvent[] = [];
  client.subscribe((event) => observed.push(event));

  const initialization = client.init();
  const initRequest = worker.requests.at(-1);
  assert.equal(initRequest?.type, "init");
  worker.emit({
    type: "ready",
    requestId: initRequest!.requestId,
    model: "test-model",
  });
  await initialization;

  const firstScore = client.score("first", ["one"]);
  const firstRejected = assert.rejects(firstScore, SemanticRequestSupersededError);
  await Promise.resolve();
  const firstRequest = worker.requests.at(-1);
  assert.equal(firstRequest?.type, "score");

  const secondScore = client.score("second", ["two"]);
  await Promise.resolve();
  await firstRejected;
  const secondRequest = worker.requests.at(-1);
  assert.equal(secondRequest?.type, "score");
  assert.notEqual(secondRequest!.requestId, firstRequest!.requestId);

  worker.emit({
    type: "error",
    requestId: firstRequest!.requestId,
    message: "late stale failure",
  });
  assert.equal(
    observed.some((event) => event.type === "error" && event.message === "late stale failure"),
    false,
  );

  worker.emit({
    type: "result",
    requestId: secondRequest!.requestId,
    scores: [{ text: "two", score: 0.75 }],
  });
  assert.deepEqual(await secondScore, [{ text: "two", score: 0.75 }]);
  client.dispose();
});
