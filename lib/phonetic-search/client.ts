import type { RecommendationIntent } from "../phonetics";
import { withBasePath } from "../public-path";
import {
  isPhoneticWorkerEvent,
  type PhoneticWorkerEvent,
  type PhoneticWorkerRequest,
  type SearchCandidate,
} from "./protocol";

type Listener = (event: PhoneticWorkerEvent) => void;

export interface SearchOptions {
  anchors: string[];
  intent: RecommendationIntent;
  semanticScores?: Record<string, number>;
  limit?: number;
  minPhonetic?: number;
  exclude?: string[];
  weights?: { sound?: number; meaning?: number; utility?: number };
}

interface Pending {
  kind: "init" | "search";
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class PhoneticSearchClient {
  private readonly worker: Worker;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private initPromise?: Promise<Extract<PhoneticWorkerEvent, { type: "ready" }>>;
  private latestSearchId?: number;

  constructor() {
    this.worker = new Worker(withBasePath("/workers/phonetic.worker.js"), {
      type: "module",
      name: "rhymegraph-phonetics",
    });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  init() {
    this.initPromise ??= this.request("init", (requestId) => ({ type: "init", requestId }));
    return this.initPromise;
  }

  async search(options: SearchOptions): Promise<SearchCandidate[]> {
    await this.init();
    if (this.latestSearchId !== undefined) {
      const stale = this.pending.get(this.latestSearchId);
      if (stale) {
        stale.reject(new Error("Search superseded by a newer query."));
        this.pending.delete(this.latestSearchId);
      }
    }
    return this.request("search", (requestId) => {
      this.latestSearchId = requestId;
      return { type: "search", requestId, ...options };
    });
  }

  dispose() {
    this.worker.terminate();
    const error = new Error("Phonetic search client disposed.");
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
    this.listeners.clear();
  }

  private request<T>(kind: Pending["kind"], build: (requestId: number) => PhoneticWorkerRequest): Promise<T> {
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { kind, resolve, reject });
      this.worker.postMessage(build(requestId));
    });
  }

  private readonly onMessage = (message: MessageEvent<unknown>) => {
    if (!isPhoneticWorkerEvent(message.data)) return;
    const event = message.data;
    this.listeners.forEach((listener) => listener(event));
    if (event.type === "progress") return;
    const pending = this.pending.get(event.requestId);
    if (!pending) return;
    if (event.type === "error") pending.reject(new Error(event.message));
    else if (event.type === "ready" && pending.kind === "init") pending.resolve(event);
    else if (event.type === "result" && pending.kind === "search") pending.resolve(event.candidates);
    else return;
    this.pending.delete(event.requestId);
    if (this.latestSearchId === event.requestId) this.latestSearchId = undefined;
  };

  private readonly onError = (event: ErrorEvent) => {
    const error = new Error(event.message || "Phonetic worker failed.");
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
    this.initPromise = undefined;
  };
}

export function createPhoneticSearchClient() {
  return new PhoneticSearchClient();
}
