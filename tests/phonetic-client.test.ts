import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { PhoneticSearchClient, searchCandidateId } from "../lib/phonetic-search/client.ts";
import type {
  PhoneticWorkerEvent,
  PhoneticWorkerRequest,
} from "../lib/phonetic-search/protocol";

class FakePhoneticWorker {
  readonly requests: PhoneticWorkerRequest[] = [];
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

  postMessage(request: PhoneticWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {}

  emit(event: PhoneticWorkerEvent) {
    const message = new MessageEvent("message", { data: event });
    this.messageListeners.forEach((listener) => listener(message));
  }
}

test("candidate IDs preserve punctuation, boundaries, and item kind", () => {
  const ids = [
    searchCandidateId("word", "first-class"),
    searchCandidateId("phrase", "first class"),
    searchCandidateId("word", "last-minute"),
    searchCandidateId("phrase", "last minute"),
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(searchCandidateId("word", "first class"), searchCandidateId("phrase", "first class"));
});

test("phonetic clients ignore events from superseded search requests", async () => {
  const worker = new FakePhoneticWorker();
  const client = new PhoneticSearchClient(worker as unknown as Worker);
  const observed: PhoneticWorkerEvent[] = [];
  client.subscribe((event) => observed.push(event));

  const initialization = client.init();
  const initRequest = worker.requests.at(-1);
  assert.equal(initRequest?.type, "init");
  worker.emit({
    type: "ready",
    requestId: initRequest!.requestId,
    words: 1,
    version: "test",
    elapsedMs: 1,
  });
  await initialization;

  const firstSearch = client.search({ anchors: ["first"], intent: "continue" });
  const firstRejected = assert.rejects(firstSearch, /superseded/i);
  await Promise.resolve();
  const firstRequest = worker.requests.at(-1);
  assert.equal(firstRequest?.type, "search");

  const secondSearch = client.search({ anchors: ["second"], intent: "continue" });
  await Promise.resolve();
  await firstRejected;
  const secondRequest = worker.requests.at(-1);
  assert.equal(secondRequest?.type, "search");
  assert.notEqual(secondRequest!.requestId, firstRequest!.requestId);

  worker.emit({
    type: "progress",
    requestId: firstRequest!.requestId,
    stage: "searching",
    progress: .78,
  });
  worker.emit({
    type: "error",
    requestId: firstRequest!.requestId,
    message: "late stale failure",
  });
  assert.equal(
    observed.some((event) => event.requestId === firstRequest!.requestId),
    false,
  );

  worker.emit({
    type: "result",
    requestId: secondRequest!.requestId,
    candidates: [],
    elapsedMs: 1,
  });
  assert.deepEqual(await secondSearch, []);
  assert.equal(
    observed.some((event) => event.type === "result" && event.requestId === secondRequest!.requestId),
    true,
  );
  client.dispose();
});
