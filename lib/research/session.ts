const RESEARCH_STORAGE_KEY = "rhymegraph.research.session.v1";
const SCHEMA_VERSION = "1.0.0";
const APP_VERSION = "0.3.0";
const MAX_EVENTS = 500;
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_COUNT = 1_000_000;
const MAX_TIMING_MS = 7 * 24 * 60 * 60 * 1000;

const INTENTS = ["continue", "bridge", "pivot"] as const;
const ENGINES = ["sound", "meaning"] as const;
const ENGINE_PHASES = ["started", "ready", "disabled", "error"] as const;
const ENGINE_TRIGGERS = ["preference", "control", "bridge", "mix", "retry"] as const;
const ANCHOR_SOURCES = ["draft", "candidate"] as const;
const CANDIDATE_ACTIONS = ["selected", "pinned", "unpinned", "expanded", "inserted", "undone"] as const;
const RELATIONS = ["full-tail", "assonance", "consonance", "slant", "mosaic", "semantic"] as const;
const VIEWS = ["map", "list"] as const;
const MEANING_STATES = ["idle", "loading", "ready", "error"] as const;

export type ResearchIntent = "continue" | "bridge" | "pivot";

export type ResearchEventInput =
  | {
      type: "engine";
      engine: "sound" | "meaning";
      phase: "started" | "ready" | "disabled" | "error";
      durationMs?: number;
      trigger?: "preference" | "control" | "bridge" | "mix" | "retry";
      itemCount?: number;
    }
  | { type: "intent"; intent: ResearchIntent }
  | { type: "anchor"; anchor: string; source: "draft" | "candidate" }
  | { type: "concept"; concept: string }
  | { type: "meaning_mix"; value: number }
  | {
      type: "neighbourhood";
      intent: ResearchIntent;
      anchorCount: number;
      resultCount: number;
      durationMs: number;
    }
  | {
      type: "candidate";
      action: "selected" | "pinned" | "unpinned" | "expanded" | "inserted" | "undone";
      candidate: string;
      anchor: string;
      intent: ResearchIntent;
      rank?: number;
      relation?: string;
    }
  | { type: "view"; view: "map" | "list" }
  | { type: "export" };

type ResearchEvent = ResearchEventInput & { atMs: number };

interface StoredSession {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  events: ResearchEvent[];
}

export interface ResearchExportContext {
  anchor: string;
  pinnedAnchors: readonly string[];
  concept?: string;
  intent: ResearchIntent;
  meaningMix: number;
  adventurousness: number;
  meaningState: "idle" | "loading" | "ready" | "error";
  dialect?: "en-US" | "en-GB";
}

export interface ResearchExport {
  schemaId: "urn:rhymegraph:research-session:1";
  schemaVersion: typeof SCHEMA_VERSION;
  appVersion: typeof APP_VERSION;
  generatedAt: string;
  privacy: {
    fullDraftIncluded: false;
    sentToNetwork: false;
    excluded: readonly ["draftText", "projectTitle", "cursorPositions"];
    included: readonly ["anchors", "concept", "candidateActions", "settings", "timings"];
  };
  session: {
    id: string;
    startedAt: string;
    durationMs: number;
    eventCount: number;
  };
  context: ResearchExportContext;
  summary: {
    candidatesSelected: number;
    candidatesInserted: number;
    candidatesUndone: number;
    candidatesExpanded: number;
    candidatesPinned: number;
    neighbourhoodsExplored: number;
    mapViews: number;
    listViews: number;
  };
  events: ResearchEvent[];
}

function safeText(value: string, maxLength = 96) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeBoundedNonNegative(value: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.round(value))) : 0;
}

function safeCount(value: number) {
  return safeBoundedNonNegative(value, MAX_COUNT);
}

function safeTiming(value: number) {
  return safeBoundedNonNegative(value, MAX_TIMING_MS);
}

function safePercentage(value: number) {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0;
}

function sessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function freshSession(now = new Date()): StoredSession {
  const timestamp = now.toISOString();
  return { id: sessionId(), startedAt: timestamp, lastActivityAt: timestamp, events: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function isStoredSession(value: unknown): value is Omit<StoredSession, "events"> & { events: unknown[] } {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<StoredSession>;
  return (
    typeof candidate.id === "string" && safeText(candidate.id, 128).length > 0 && candidate.id.length <= 128 &&
    typeof candidate.startedAt === "string" && Number.isFinite(Date.parse(candidate.startedAt)) &&
    typeof candidate.lastActivityAt === "string" && Number.isFinite(Date.parse(candidate.lastActivityAt)) &&
    Array.isArray(candidate.events)
  );
}

function readStoredSession(storage: Storage, now = Date.now()): StoredSession | null {
  try {
    const raw = storage.getItem(RESEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredSession(parsed)) return null;
    const startedAt = Date.parse(parsed.startedAt);
    const lastActivity = Date.parse(parsed.lastActivityAt);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(lastActivity) ||
      startedAt > lastActivity ||
      startedAt > now + MAX_CLOCK_SKEW_MS ||
      lastActivity > now + MAX_CLOCK_SKEW_MS ||
      now - lastActivity > SESSION_MAX_AGE_MS
    ) {
      return null;
    }
    const events = parsed.events.slice(-MAX_EVENTS).flatMap((event) => {
      if (!isRecord(event) || typeof event.atMs !== "number" || !Number.isFinite(event.atMs)) return [];
      const sanitized = sanitizeEvent(event, event.atMs);
      return sanitized ? [sanitized] : [];
    });
    return {
      id: safeText(parsed.id, 128),
      startedAt: new Date(startedAt).toISOString(),
      lastActivityAt: new Date(lastActivity).toISOString(),
      events,
    };
  } catch {
    return null;
  }
}

function restoreSession(storage: Storage, now = Date.now()) {
  return readStoredSession(storage, now) ?? freshSession(new Date(now));
}

function sanitizeEvent(input: unknown, atMs: number): ResearchEvent | null {
  if (!isRecord(input) || typeof input.type !== "string") return null;
  const safeAtMs = safeTiming(atMs);
  switch (input.type) {
    case "engine": {
      if (!isOneOf(input.engine, ENGINES) || !isOneOf(input.phase, ENGINE_PHASES)) return null;
      const trigger = input.trigger === undefined || isOneOf(input.trigger, ENGINE_TRIGGERS)
        ? input.trigger
        : undefined;
      return {
        type: "engine",
        engine: input.engine,
        phase: input.phase,
        durationMs: typeof input.durationMs === "number" ? safeTiming(input.durationMs) : undefined,
        trigger,
        itemCount: typeof input.itemCount === "number" ? safeCount(input.itemCount) : undefined,
        atMs: safeAtMs,
      };
    }
    case "intent":
      if (!isOneOf(input.intent, INTENTS)) return null;
      return { type: "intent", intent: input.intent, atMs: safeAtMs };
    case "anchor": {
      if (typeof input.anchor !== "string" || !isOneOf(input.source, ANCHOR_SOURCES)) return null;
      const anchor = safeText(input.anchor);
      return anchor ? { type: "anchor", anchor, source: input.source, atMs: safeAtMs } : null;
    }
    case "concept": {
      if (typeof input.concept !== "string") return null;
      const concept = safeText(input.concept, 120);
      return concept ? { type: "concept", concept, atMs: safeAtMs } : null;
    }
    case "meaning_mix":
      if (typeof input.value !== "number") return null;
      return { type: "meaning_mix", value: safePercentage(input.value), atMs: safeAtMs };
    case "neighbourhood":
      if (
        !isOneOf(input.intent, INTENTS) ||
        typeof input.anchorCount !== "number" ||
        typeof input.resultCount !== "number" ||
        typeof input.durationMs !== "number"
      ) return null;
      return {
        type: "neighbourhood",
        intent: input.intent,
        anchorCount: safeCount(input.anchorCount),
        resultCount: safeCount(input.resultCount),
        durationMs: safeTiming(input.durationMs),
        atMs: safeAtMs,
      };
    case "candidate": {
      if (
        !isOneOf(input.action, CANDIDATE_ACTIONS) ||
        typeof input.candidate !== "string" ||
        typeof input.anchor !== "string" ||
        !isOneOf(input.intent, INTENTS)
      ) return null;
      const candidate = safeText(input.candidate);
      const anchor = safeText(input.anchor);
      if (!candidate || !anchor) return null;
      const relation = input.relation === undefined || isOneOf(input.relation, RELATIONS)
        ? input.relation
        : undefined;
      return {
        type: "candidate",
        action: input.action,
        candidate,
        anchor,
        intent: input.intent,
        rank: typeof input.rank === "number" ? safeCount(input.rank) : undefined,
        relation,
        atMs: safeAtMs,
      };
    }
    case "view":
      if (!isOneOf(input.view, VIEWS)) return null;
      return { type: "view", view: input.view, atMs: safeAtMs };
    case "export":
      return { type: "export", atMs: safeAtMs };
    default:
      return null;
  }
}

function safeContext(context: ResearchExportContext): ResearchExportContext {
  const anchor = typeof context.anchor === "string" ? safeText(context.anchor) : "";
  const pinnedAnchors = Array.isArray(context.pinnedAnchors)
    ? context.pinnedAnchors.flatMap((value) => typeof value === "string" ? [safeText(value)] : [])
    : [];
  return {
    anchor,
    pinnedAnchors: pinnedAnchors.filter(Boolean).slice(0, 4),
    concept: typeof context.concept === "string" && context.concept ? safeText(context.concept, 120) : undefined,
    intent: isOneOf(context.intent, INTENTS) ? context.intent : "continue",
    meaningMix: safePercentage(context.meaningMix),
    adventurousness: safePercentage(context.adventurousness),
    meaningState: isOneOf(context.meaningState, MEANING_STATES) ? context.meaningState : "idle",
    dialect: context.dialect === "en-US" || context.dialect === "en-GB" ? context.dialect : undefined,
  };
}

export class LocalResearchSession {
  private state: StoredSession;
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
    this.state = restoreSession(storage);
    this.persist();
  }

  record(input: ResearchEventInput) {
    const now = new Date();
    const startedAt = Date.parse(this.state.startedAt);
    const atMs = Math.max(0, now.getTime() - (Number.isFinite(startedAt) ? startedAt : now.getTime()));
    const event = sanitizeEvent(input, atMs);
    if (!event) return;
    this.state = {
      ...this.state,
      lastActivityAt: now.toISOString(),
      events: [...this.state.events, event].slice(-MAX_EVENTS),
    };
    this.persist();
  }

  snapshot(context: ResearchExportContext): ResearchExport {
    const generatedAt = new Date();
    const events = this.state.events.flatMap((event) => {
      try {
        const sanitized = sanitizeEvent(event, event.atMs);
        return sanitized ? [sanitized] : [];
      } catch {
        return [];
      }
    });
    const count = (action: Extract<ResearchEventInput, { type: "candidate" }>["action"]) =>
      events.filter((event) => event.type === "candidate" && event.action === action).length;

    return {
      schemaId: "urn:rhymegraph:research-session:1",
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      generatedAt: generatedAt.toISOString(),
      privacy: {
        fullDraftIncluded: false,
        sentToNetwork: false,
        excluded: ["draftText", "projectTitle", "cursorPositions"],
        included: ["anchors", "concept", "candidateActions", "settings", "timings"],
      },
      session: {
        id: safeText(this.state.id, 128),
        startedAt: this.state.startedAt,
        durationMs: safeTiming(generatedAt.getTime() - Date.parse(this.state.startedAt)),
        eventCount: events.length,
      },
      context: safeContext(context),
      summary: {
        candidatesSelected: count("selected"),
        candidatesInserted: count("inserted"),
        candidatesUndone: count("undone"),
        candidatesExpanded: count("expanded"),
        candidatesPinned: count("pinned"),
        neighbourhoodsExplored: events.filter((event) => event.type === "neighbourhood").length,
        mapViews: events.filter((event) => event.type === "view" && event.view === "map").length,
        listViews: events.filter((event) => event.type === "view" && event.view === "list").length,
      },
      events,
    };
  }

  clear() {
    this.storage.removeItem(RESEARCH_STORAGE_KEY);
    this.state = freshSession();
  }

  private persist() {
    try {
      this.storage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Research capture is deliberately best-effort and must never interrupt writing.
    }
  }
}

export function createLocalResearchSession() {
  return new LocalResearchSession(window.sessionStorage);
}

export function resumeLocalResearchSession() {
  if (!readStoredSession(window.sessionStorage)) {
    try {
      window.sessionStorage.removeItem(RESEARCH_STORAGE_KEY);
    } catch {
      // An unavailable session store means research remains off.
    }
    return null;
  }
  return new LocalResearchSession(window.sessionStorage);
}

export function downloadResearchSession(session: ResearchExport) {
  const blob = new Blob([`${JSON.stringify(session, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = session.generatedAt.replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `rhymegraph-research-${timestamp}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
