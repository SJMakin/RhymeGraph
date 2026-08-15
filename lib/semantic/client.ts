import {
  isSemanticWorkerEvent,
  type SemanticErrorEvent,
  type SemanticIndexSummary,
  type SemanticReadyEvent,
  type SemanticRetrievalHit,
  type SemanticScore,
  type SemanticWorkerEvent,
  type SemanticWorkerRequest,
} from "./protocol";
import { withBasePath } from "../public-path";

type SemanticEventListener = (event: SemanticWorkerEvent) => void;

interface PendingRequest<T> {
  kind: "init" | "score" | "retrieve";
  resolve(value: T): void;
  reject(reason: Error): void;
}

export class SemanticRequestSupersededError extends Error {
  constructor() {
    super("Semantic request was superseded by a newer request of the same kind.");
    this.name = "SemanticRequestSupersededError";
  }
}

export class SemanticClient {
  private readonly worker: Worker;
  private readonly listeners = new Set<SemanticEventListener>();
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 1;
  private latestScoreRequestId: number | undefined;
  private latestRetrieveRequestId: number | undefined;
  private readyPromise: Promise<SemanticReadyEvent> | undefined;
  private disposed = false;

  constructor(worker?: Worker) {
    this.worker =
      worker ??
      new Worker(withBasePath("/workers/semantic.worker.v3.js"), {
        type: "module",
        name: "rhymegraph-semantic",
      });

    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  subscribe(listener: SemanticEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  init(): Promise<SemanticReadyEvent> {
    this.assertActive();
    this.readyPromise ??= this.request<SemanticReadyEvent>("init", (requestId) => ({
      type: "init",
      requestId,
    })).catch((error: unknown) => {
      this.readyPromise = undefined;
      throw error;
    });
    return this.readyPromise;
  }

  /**
   * Scores and sorts candidates by meaning. A later score call supersedes an
   * earlier unfinished call, preventing a slow old query from repainting new UI.
   */
  async score(queryText: string, candidates: readonly string[]): Promise<SemanticScore[]> {
    this.assertActive();
    await this.init();

    if (this.latestScoreRequestId !== undefined) {
      const stale = this.pending.get(this.latestScoreRequestId);
      if (stale?.kind === "score") {
        stale.reject(new SemanticRequestSupersededError());
        this.pending.delete(this.latestScoreRequestId);
      }
    }

    return this.request<SemanticScore[]>("score", (requestId) => {
      this.latestScoreRequestId = requestId;
      return {
        type: "score",
        requestId,
        queryText,
        candidates: [...candidates],
      };
    });
  }

  /**
   * Searches the checked-in whole-vocabulary index. The returned score uses one
   * corpus-level calibration for every query; cosine is also retained so callers
   * can evaluate or replace that calibration without reconstructing it.
   */
  async retrieve(
    queryText: string,
    options: { limit?: number; exclude?: readonly string[] } = {},
  ): Promise<{ hits: SemanticRetrievalHit[]; index: SemanticIndexSummary }> {
    this.assertActive();
    // Let the explicitly requested index download overlap first-time model
    // initialization. Both worker operations share the same extractor promise.
    const initialization = this.init();

    if (this.latestRetrieveRequestId !== undefined) {
      const stale = this.pending.get(this.latestRetrieveRequestId);
      if (stale?.kind === "retrieve") {
        stale.reject(new SemanticRequestSupersededError());
        this.pending.delete(this.latestRetrieveRequestId);
      }
    }

    const retrieval = this.request<{ hits: SemanticRetrievalHit[]; index: SemanticIndexSummary }>(
      "retrieve",
      (requestId) => {
        this.latestRetrieveRequestId = requestId;
        return {
          type: "retrieve",
          requestId,
          queryText,
          limit: options.limit,
          exclude: options.exclude ? [...options.exclude] : undefined,
        };
      },
    );
    const [, result] = await Promise.all([initialization, retrieval]);
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
    const error = new Error("Semantic client was disposed.");
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
    this.listeners.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Semantic client was disposed.");
  }

  private emit(event: SemanticWorkerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private request<T>(
    kind: PendingRequest<T>["kind"],
    createRequest: (requestId: number) => SemanticWorkerRequest,
  ): Promise<T> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        kind,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage(createRequest(requestId));
    });
  }

  private readonly handleMessage = (message: MessageEvent<unknown>): void => {
    if (!isSemanticWorkerEvent(message.data)) return;
    const event = message.data;
    const pending = this.pending.get(event.requestId);
    if (!pending) return; // Superseded or otherwise stale response.

    if (event.type === "error") {
      this.emit(event);
      pending.reject(new Error(event.message));
    } else if (event.type === "ready" && pending.kind === "init") {
      this.emit(event);
      pending.resolve(event);
    } else if (event.type === "result" && pending.kind === "score") {
      this.emit(event);
      pending.resolve(event.scores);
    } else if (event.type === "retrieved" && pending.kind === "retrieve") {
      this.emit(event);
      pending.resolve({ hits: event.hits, index: event.index });
    } else {
      return;
    }

    this.pending.delete(event.requestId);
    if (event.requestId === this.latestScoreRequestId) this.latestScoreRequestId = undefined;
    if (event.requestId === this.latestRetrieveRequestId) this.latestRetrieveRequestId = undefined;
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const message = event.message || "Semantic worker failed.";
    const semanticError: SemanticErrorEvent = {
      type: "error",
      requestId: 0,
      message,
    };
    this.emit(semanticError);
    const error = new Error(message);
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
    this.readyPromise = undefined;
    this.latestScoreRequestId = undefined;
    this.latestRetrieveRequestId = undefined;
  };
}

export function createSemanticClient(): SemanticClient {
  return new SemanticClient();
}
