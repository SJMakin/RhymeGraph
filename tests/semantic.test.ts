import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { cosineSimilarity, rankByCosine } from "../lib/semantic/cosine.ts";
// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { SemanticClient, SemanticRequestSupersededError } from "../lib/semantic/client.ts";
import type { SemanticWorkerEvent, SemanticWorkerRequest } from "../lib/semantic/protocol.ts";

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
