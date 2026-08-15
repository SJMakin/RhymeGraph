import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// @ts-expect-error Node's experimental type stripper requires the explicit extension.
import { LocalResearchSession } from "../lib/research/session.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

class RemovalDeniedStorage extends MemoryStorage {
  override removeItem() {
    throw new Error("storage removal denied");
  }
}

const context = {
  anchor: "gravity",
  pinnedAnchors: ["cavity"],
  concept: "pressure and escape",
  intent: "bridge" as const,
  meaningMix: 42,
  adventurousness: 58,
  meaningState: "ready" as const,
};

test("research export is versioned, useful, and excludes draft content", () => {
  const storage = new MemoryStorage();
  const session = new LocalResearchSession(storage);
  session.record({ type: "view", view: "list" });
  session.record({
    type: "candidate",
    action: "inserted",
    candidate: "cavity",
    anchor: "gravity",
    intent: "bridge",
    rank: 2,
    relation: "assonance",
  });
  session.record({
    type: "candidate",
    action: "undone",
    candidate: "cavity",
    anchor: "gravity",
    intent: "bridge",
    rank: 2,
    relation: "assonance",
  });

  const exported = session.snapshot(context);
  const serialized = JSON.stringify(exported);
  assert.equal(exported.schemaVersion, "1.0.0");
  assert.equal(exported.schemaId, "urn:rhymegraph:research-session:1");
  assert.equal(exported.appVersion, "0.3.0");
  assert.equal(exported.privacy.fullDraftIncluded, false);
  assert.equal(exported.privacy.sentToNetwork, false);
  assert.deepEqual(exported.privacy.excluded, ["draftText", "projectTitle", "cursorPositions"]);
  assert.equal(exported.summary.candidatesInserted, 1);
  assert.equal(exported.summary.candidatesUndone, 1);
  assert.equal(exported.summary.listViews, 1);
  assert.equal(serialized.includes("THE PRIVATE FULL DRAFT"), false);
  assert.equal("draft" in exported.context, false);
  assert.ok(Number.isFinite(exported.session.durationMs));
});

test("the shipped research JSON Schema identifies and covers the exported shape", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../evaluation/research-session-schema.v1.json", import.meta.url),
    "utf8",
  )) as {
    $id: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  const exported = new LocalResearchSession(new MemoryStorage()).snapshot(context);
  assert.equal(schema.$id, exported.schemaId);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.every((key) => Object.hasOwn(exported, key)));
  assert.ok(Object.keys(exported).every((key) => Object.hasOwn(schema.properties, key)));
});

test("research storage corruption and non-finite event data cannot poison exports", () => {
  const storage = new MemoryStorage();
  storage.setItem("rhymegraph.research.session.v1", JSON.stringify({
    id: "bad-session",
    startedAt: "not-a-date",
    lastActivityAt: new Date().toISOString(),
    events: [{ type: "meaning_mix", value: Number.NaN, atMs: Number.NaN }],
  }));

  const session = new LocalResearchSession(storage);
  session.record({ type: "meaning_mix", value: Number.NaN });
  session.record({
    type: "neighbourhood",
    intent: "continue",
    anchorCount: Number.POSITIVE_INFINITY,
    resultCount: Number.NaN,
    durationMs: Number.NEGATIVE_INFINITY,
  });
  const exported = session.snapshot({
    ...context,
    meaningMix: Number.NaN,
    adventurousness: Number.POSITIVE_INFINITY,
  });

  assert.ok(Number.isFinite(Date.parse(exported.session.startedAt)));
  assert.ok(Number.isFinite(exported.session.durationMs));
  assert.equal(exported.context.meaningMix, 0);
  assert.equal(exported.context.adventurousness, 0);
  assert.ok(exported.events.every((event) => Number.isFinite(event.atMs)));
  assert.equal(JSON.stringify(exported).includes(":null"), false);
});

test("restored sessions discard invalid nested event enums and bound valid fields", () => {
  const storage = new MemoryStorage();
  const now = new Date();
  storage.setItem("rhymegraph.research.session.v1", JSON.stringify({
    id: "valid-session",
    startedAt: new Date(now.getTime() - 2_000).toISOString(),
    lastActivityAt: now.toISOString(),
    events: [
      { type: "intent", intent: "exfiltrate", atMs: 1 },
      { type: "engine", engine: "remote", phase: "ready", atMs: 2 },
      { type: "candidate", action: "delete-draft", candidate: "cavity", anchor: "gravity", intent: "bridge", atMs: 3 },
      { type: "view", view: "timeline", atMs: 4 },
      { type: "meaning_mix", value: "75", atMs: 5 },
      { type: "export", atMs: "not-a-number" },
      { type: "anchor", anchor: `  ${"a".repeat(200)}  `, source: "draft", atMs: 6 },
      {
        type: "candidate",
        action: "inserted",
        candidate: "cavity",
        anchor: "gravity",
        intent: "bridge",
        rank: 9_999_999,
        relation: "invented-relation",
        atMs: 7,
      },
      { type: "export", atMs: 8 },
    ],
  }));

  const exported = new LocalResearchSession(storage).snapshot(context);
  assert.deepEqual(exported.events.map((event) => event.type), ["anchor", "candidate", "export"]);
  const anchorEvent = exported.events[0];
  assert.equal(anchorEvent.type, "anchor");
  if (anchorEvent.type === "anchor") assert.equal(anchorEvent.anchor.length, 96);
  const candidateEvent = exported.events[1];
  assert.equal(candidateEvent.type, "candidate");
  if (candidateEvent.type === "candidate") {
    assert.equal(candidateEvent.rank, 1_000_000);
    assert.equal(candidateEvent.relation, undefined);
  }
  assert.ok(exported.events.every((event) => Number.isFinite(event.atMs)));
});

test("clearing a research session removes its per-tab storage record", () => {
  const storage = new MemoryStorage();
  const session = new LocalResearchSession(storage);
  session.record({ type: "view", view: "map" });
  assert.notEqual(storage.getItem("rhymegraph.research.session.v1"), null);
  session.clear();
  assert.equal(storage.getItem("rhymegraph.research.session.v1"), null);
});

test("clearing surfaces storage removal failures instead of claiming deletion", () => {
  const storage = new RemovalDeniedStorage();
  const session = new LocalResearchSession(storage);
  session.record({ type: "view", view: "map" });
  assert.throws(() => session.clear(), /storage removal denied/);
  assert.notEqual(storage.getItem("rhymegraph.research.session.v1"), null);
});

test("long-session timings remain distinct beyond one million milliseconds", () => {
  const storage = new MemoryStorage();
  const now = Date.now();
  storage.setItem("rhymegraph.research.session.v1", JSON.stringify({
    id: "long-session",
    startedAt: new Date(now - 25 * 60 * 1_000).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    events: [{ type: "view", view: "list", atMs: 1_200_000 }],
  }));
  const session = new LocalResearchSession(storage);
  session.record({ type: "export" });
  const exported = session.snapshot(context);
  assert.equal(exported.events[0].atMs, 1_200_000);
  assert.ok(exported.events[1].atMs > 1_000_000);
  assert.ok(exported.session.durationMs > 1_000_000);
});
