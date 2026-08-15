"use client";

/* eslint-disable react-hooks/preserve-manual-memoization -- React state setters are stable dependencies. */

import {
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CornerDownLeft,
  Download,
  Focus,
  Gauge,
  History,
  LayoutGrid,
  List,
  Map as MapIcon,
  Maximize2,
  Mic2,
  Minimize2,
  Network,
  Pin,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { withBasePath } from "@/lib/public-path";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEMO_CANDIDATES,
  INITIAL_DRAFT,
  RELATION_LABEL,
  type CandidateView,
  type RelationshipKind,
} from "../lib/demo-data";
import { buildLocalCandidateGraph } from "../lib/explorer/local-graph";
import type { PhoneticSearchClient, SearchCandidate } from "../lib/phonetic-search";
import {
  createLocalResearchSession,
  downloadResearchSession,
  resumeLocalResearchSession,
  type LocalResearchSession,
  type ResearchEventInput,
} from "../lib/research/session";
import type { SemanticClient } from "../lib/semantic";
import { createHybridSearchPolicy, normalizeCandidateText } from "../lib/search/hybrid";

type Intent = "continue" | "bridge" | "pivot";
type Dialect = "en-US" | "en-GB";
type EngineStatus = "loading" | "ready" | "error";
type SemanticStatus = "idle" | "loading" | "ready" | "error";
type MobilePanel = "write" | "explore";
type ResultView = "family" | "map" | "list";
type SaveStatus = "pending" | "saved" | "error";
type FamilyChannel = "locked" | "vowel" | "consonant" | "phrase" | "meaning";
type SemanticTrigger = NonNullable<Extract<ResearchEventInput, { type: "engine" }>["trigger"]>;

interface AnchorRange {
  start: number;
  end: number;
}

const STORAGE_KEY = "rhymegraph.project.v1";
const SEMANTIC_PREFERENCE_KEY = "rhymegraph.semantic.enabled.v1";
const SEMANTIC_DOWNLOAD_LABEL = "about 69 MiB";
const MAX_DRAFT_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 120;
const MAX_PROJECT_TOKEN_LENGTH = 96;
const MAX_PIN_COUNT = 4;
const MAX_BREADCRUMB_COUNT = 8;
const DEMO_BY_WORD = new Map(DEMO_CANDIDATES.map((candidate) => [candidate.word, candidate]));
const FAMILY_CARD_LIMIT = 4;

const FAMILY_CHANNELS: Array<{
  id: FamilyChannel;
  name: string;
  shortName: string;
  description: string;
}> = [
  { id: "locked", name: "Locked landings", shortName: "Locked", description: "Full tails and closest closures" },
  { id: "vowel", name: "Vowel & slant", shortName: "Vowel", description: "Shared colour with room to bend" },
  { id: "consonant", name: "Consonant echoes", shortName: "Consonant", description: "Codas, consonant skeletons and rough texture" },
  { id: "phrase", name: "Phrase & mosaic", shortName: "Phrase", description: "Cross-word and multi-beat landings" },
  { id: "meaning", name: "Meaning & sideways", shortName: "Sideways", description: "Conceptual turns that keep the pocket" },
];

const RELATION_ACCENT: Record<RelationshipKind, string> = {
  "full-tail": "var(--accent-lime)",
  assonance: "var(--accent-amber)",
  consonance: "var(--accent-cyan)",
  slant: "var(--accent-coral)",
  mosaic: "var(--accent-coral)",
  semantic: "var(--accent-lilac)",
};

const RELATION_CLASS: Record<RelationshipKind, string> = {
  "full-tail": "relation-full",
  assonance: "relation-vowel",
  consonance: "relation-coda",
  slant: "relation-flow",
  mosaic: "relation-flow",
  semantic: "relation-meaning",
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function relationshipFor(result: SearchCandidate): RelationshipKind {
  if (result.labels.includes("semantic-bridge")) return "semantic";
  if (result.semantic >= 68 && result.semantic >= result.phonetic + 8) return "semantic";
  if (result.labels.includes("mosaic")) return "mosaic";
  if (result.labels.includes("full-rhyme")) return "full-tail";
  if (result.labels.includes("assonance") && result.assonance >= result.consonance) return "assonance";
  if (result.labels.includes("consonance")) return "consonance";
  return "slant";
}

function candidateFitsFamily(candidate: CandidateView, channel: FamilyChannel) {
  const evidence = `${candidate.reasons.join(" ")} ${(candidate.tags ?? []).join(" ")}`.toLowerCase();
  if (channel === "phrase") return Boolean(candidate.phrase || candidate.relation === "mosaic");
  if (channel === "meaning") {
    return candidate.relation === "semantic" || (candidate.meaning >= 65 && candidate.meaning >= candidate.sound - 8);
  }
  if (channel === "locked") return candidate.relation === "full-tail";
  if (channel === "vowel") {
    return candidate.relation === "assonance"
      || candidate.relation === "slant"
      || /\b(vowel|assonance|slant)\b/.test(evidence);
  }
  if (channel === "consonant") {
    return candidate.relation === "consonance"
      || /\b(coda|consonant|internal)\b/.test(evidence);
  }
  return false;
}

function familyEvidence(candidate: CandidateView, channel: FamilyChannel) {
  const patterns: Record<FamilyChannel, RegExp> = {
    locked: /full|tail|ending|closure|strongest/i,
    vowel: /vowel|assonance|slant/i,
    consonant: /coda|consonant|internal/i,
    phrase: /phrase|mosaic|cross-word|multi/i,
    meaning: /meaning|semantic|concept|context/i,
  };
  return candidate.reasons.find((reason) => patterns[channel].test(reason))
    ?? candidate.reasons[0]
    ?? RELATION_LABEL[candidate.relation];
}

function meaningState(value: number, enabled: boolean) {
  if (!enabled || value === 0) return "Sound only";
  if (value < 35) return "Sound-led";
  if (value < 66) return "Balanced";
  return "Meaning-led";
}

function reachState(value: number) {
  if (value < 25) return "Close";
  if (value < 55) return "Open";
  if (value < 80) return "Wide";
  return "Far out";
}

function humanizeReason(reason: string) {
  return reason
    .replace(/\.$/, "")
    .replace(/\b(\d+)%\b/g, "$1%")
    .replace(/^./, (character) => character.toLowerCase());
}

function fromSearchCandidate(result: SearchCandidate): CandidateView {
  const seeded = DEMO_BY_WORD.get(result.word);
  const relation = relationshipFor(result);
  return {
    id: result.id,
    word: result.word,
    pronunciation: result.pronunciation,
    definition:
      seeded?.definition ??
      (result.tags.length > 0
        ? `${result.tags.join(" · ")} in the local English lexicon`
        : "word in the local pronunciation lexicon"),
    overall: result.overall,
    sound: result.phonetic,
    meaning: result.semantic,
    flow: result.stress,
    syllables: result.syllables,
    relation,
    reasons:
      result.reasons.length > 0
        ? result.reasons.map(humanizeReason)
        : ["phonetic neighbour", `${result.syllables} syllables`],
    phrase: result.phrase,
    estimated: result.estimated,
    tags: result.tags,
  };
}

function wordAtCursor(text: string, cursor: number) {
  const isWord = (character: string) => /[\p{L}'’-]/u.test(character);
  let start = cursor;
  let end = cursor;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end < text.length && isWord(text[end])) end += 1;
  return { text: text.slice(start, end).trim(), start, end };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedProjectString(value: unknown, maxLength: number, trim = false) {
  if (typeof value !== "string") return undefined;
  const bounded = value.slice(0, maxLength);
  return trim ? bounded.replace(/\s+/g, " ").trim() : bounded;
}

function boundedProjectList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .slice(0, 64)
      .flatMap((item) => {
        const bounded = boundedProjectString(item, MAX_PROJECT_TOKEN_LENGTH, true);
        return bounded ? [bounded] : [];
      }),
  )].slice(0, maxItems);
}

function restoreProject(value: unknown) {
  if (!isRecord(value)) return null;
  const draft = boundedProjectString(value.draft, MAX_DRAFT_LENGTH) ?? INITIAL_DRAFT;
  const title = boundedProjectString(value.title, MAX_TITLE_LENGTH) ?? "untitled verse 03";
  const pins = boundedProjectList(value.pins, MAX_PIN_COUNT);
  const storedAnchor = boundedProjectString(value.anchor, MAX_PROJECT_TOKEN_LENGTH, true) ?? "";
  const storedRange = value.anchorRange;
  let range: AnchorRange | null = null;
  if (isRecord(storedRange)) {
    const { start, end } = storedRange;
    if (
      typeof start === "number" &&
      typeof end === "number" &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= draft.length &&
      storedAnchor &&
      draft.slice(start, end).trim().toLocaleLowerCase("en") === storedAnchor.toLocaleLowerCase("en")
    ) {
      range = { start, end };
    }
  }
  const fallback = wordAtCursor(draft, draft.length);
  const fallbackAnchor = boundedProjectString(fallback.text, MAX_PROJECT_TOKEN_LENGTH, true) ?? "";
  const anchor = range ? storedAnchor : fallbackAnchor;
  const anchorRange = range ?? {
    start: fallback.start,
    end: Math.min(draft.length, fallback.start + fallbackAnchor.length),
  };
  const restoredBreadcrumbs = boundedProjectList(value.breadcrumbs, MAX_BREADCRUMB_COUNT);
  return {
    draft,
    title,
    pins,
    anchor,
    anchorRange,
    breadcrumbs: restoredBreadcrumbs.length > 0
      ? restoredBreadcrumbs
      : anchor ? [anchor] : [],
    dialect: value.dialect === "en-US" ? "en-US" as const : "en-GB" as const,
  };
}

function getActiveLine(text: string, range: AnchorRange) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1;
  const nextBreak = text.indexOf("\n", range.end);
  return text.slice(lineStart, nextBreak === -1 ? text.length : nextBreak);
}

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="score-row">
      <div className="score-label">
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <div className="score-track" aria-hidden="true">
        <span style={{ width: `${clamp(value)}%`, background: tone }} />
      </div>
    </div>
  );
}

function EngineDot({ status }: { status: EngineStatus | SemanticStatus }) {
  return <span className={`engine-dot engine-${status}`} aria-hidden="true" />;
}

export function RhymeStudio() {
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [projectTitle, setProjectTitle] = useState("untitled verse 03");
  const [anchor, setAnchor] = useState("gravity");
  const initialAnchorStart = INITIAL_DRAFT.lastIndexOf("gravity");
  const [anchorRange, setAnchorRange] = useState<AnchorRange>({
    start: initialAnchorStart,
    end: initialAnchorStart + "gravity".length,
  });
  const [intent, setIntent] = useState<Intent>("continue");
  const [dialect, setDialect] = useState<Dialect>("en-GB");
  const [concept, setConcept] = useState("money and pressure");
  const [meaningBalance, setMeaningBalance] = useState(34);
  const [adventurousness, setAdventurousness] = useState(48);
  const [syllableFilter, setSyllableFilter] = useState("any");
  const [partOfSpeech, setPartOfSpeech] = useState("any");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>(["gravity"]);
  const [candidates, setCandidates] = useState<CandidateView[]>(DEMO_CANDIDATES);
  const [baseCandidates, setBaseCandidates] = useState<CandidateView[]>(DEMO_CANDIDATES);
  const [baseCandidatesRevision, setBaseCandidatesRevision] = useState(0);
  const [selectedId, setSelectedId] = useState("salary");
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engineProgress, setEngineProgress] = useState(8);
  const [lexiconCount, setLexiconCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>("idle");
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const [semanticQuery, setSemanticQuery] = useState(
    getActiveLine(INITIAL_DRAFT, {
      start: initialAnchorStart,
      end: initialAnchorStart + "gravity".length,
    }),
  );
  const [statusMessage, setStatusMessage] = useState("Loading local sound map");
  const [viewMode, setViewMode] = useState<ResultView>("family");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("write");
  const [exploreFocused, setExploreFocused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("pending");
  const [undoState, setUndoState] = useState<{
    draft: string;
    range: AnchorRange;
    anchor: string;
    breadcrumbs: string[];
    inserted: string;
    relation: RelationshipKind;
    rank: number;
    intent: Intent;
  } | null>(null);
  const [voiceNoteOpen, setVoiceNoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [researchActive, setResearchActive] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const phoneticRef = useRef<PhoneticSearchClient | null>(null);
  const semanticRef = useRef<SemanticClient | null>(null);
  const semanticUnsubscribeRef = useRef<() => void>(() => {});
  const semanticAttemptRef = useRef<{ revision: number; startedAt: number; settled: boolean } | null>(null);
  const semanticLifecycleRevision = useRef(0);
  const pendingSemanticTrigger = useRef<SemanticTrigger>("preference");
  const researchRef = useRef<LocalResearchSession | null>(null);
  const soundStartedAt = useRef(0);
  const soundSearchRevision = useRef(0);
  const hybridSearchRevision = useRef(0);
  const semanticRerankInputRef = useRef<{
    source: CandidateView[];
    query: string;
    status: SemanticStatus;
  } | null>(null);

  const recordResearch = useCallback((event: ResearchEventInput) => {
    researchRef.current?.record(event);
  }, []);

  const filteredCandidates = useMemo(() => {
    return candidates
      .filter((candidate) =>
        syllableFilter === "any" ||
        (syllableFilter === "4"
          ? candidate.syllables >= 4
          : candidate.syllables === Number(syllableFilter)),
      )
      .filter((candidate) => partOfSpeech === "any" || candidate.tags?.includes(partOfSpeech));
  }, [candidates, syllableFilter, partOfSpeech]);

  const visibleCandidates = useMemo(
    () => filteredCandidates.slice(0, 18),
    [filteredCandidates],
  );
  const filtersActive = syllableFilter !== "any" || partOfSpeech !== "any";

  const localGraph = useMemo(
    () => buildLocalCandidateGraph(visibleCandidates.map((candidate) => ({
      id: candidate.id,
      word: candidate.word,
      pronunciation: candidate.pronunciation,
      overall: candidate.overall,
      sound: candidate.sound,
    }))),
    [visibleCandidates],
  );
  const graphNodeById = useMemo(
    () => new Map(localGraph.nodes.map((node) => [node.id, node])),
    [localGraph],
  );

  const selected = useMemo(
    () => filteredCandidates.find((candidate) => candidate.id === selectedId)
      ?? filteredCandidates[0],
    [filteredCandidates, selectedId],
  );
  const effectiveMeaningBalance = semanticEnabled && semanticStatus === "ready"
    ? meaningBalance
    : 0;
  const meaningControlState = semanticStatus === "error"
    ? "Unavailable"
    : semanticStatus === "loading"
      ? "Loading"
      : meaningState(effectiveMeaningBalance, effectiveMeaningBalance > 0);

  const familyGroups = useMemo(
    () => FAMILY_CHANNELS.map((channel) => {
      const channelCandidates = filteredCandidates
        .filter((candidate) => candidateFitsFamily(candidate, channel.id));
      return {
        ...channel,
        total: channelCandidates.length,
        candidates: channelCandidates.slice(0, FAMILY_CARD_LIMIT),
      };
    }),
    [filteredCandidates],
  );

  useEffect(() => {
    const resumeTimer = window.setTimeout(() => {
      try {
        const existing = resumeLocalResearchSession();
        researchRef.current = existing;
        setResearchActive(Boolean(existing));
      } catch {
        // Research remains off when per-tab storage is unavailable.
      }
    }, 0);
    return () => {
      window.clearTimeout(resumeTimer);
      researchRef.current = null;
    };
  }, []);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const restored = restoreProject(JSON.parse(saved));
          if (restored) {
            setDraft(restored.draft);
            setProjectTitle(restored.title);
            setPins(restored.pins);
            setAnchor(restored.anchor);
            setAnchorRange(restored.anchorRange);
            setBreadcrumbs(restored.breadcrumbs);
            setDialect(restored.dialect);
          }
        }
      } catch {
        setToast("Saved draft data was ignored because it is unavailable or malformed");
      }
      try {
        const semanticPreference = window.localStorage.getItem(SEMANTIC_PREFERENCE_KEY);
        if (semanticPreference === "true") {
          pendingSemanticTrigger.current = "preference";
          setSemanticEnabled(true);
        }
      } catch {
        // A missing preference must never opt into the optional meaning engine.
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          draft,
          title: projectTitle,
          pins,
          anchor,
          anchorRange,
          breadcrumbs,
          dialect,
        }),
      );
      window.queueMicrotask(() => setSaveStatus("saved"));
    } catch {
      window.queueMicrotask(() => {
        setSaveStatus("error");
        setToast("Draft isn’t being saved on this device");
      });
    }
  }, [draft, projectTitle, pins, anchor, anchorRange, breadcrumbs, dialect, hydrated]);

  useEffect(() => {
    let cancelled = false;
    let soundInitializationSettled = false;
    let unsubscribePhonetic = () => {};
    soundStartedAt.current = performance.now();
    recordResearch({ type: "engine", engine: "sound", phase: "started" });

    const failSoundInitialization = () => {
      if (cancelled || soundInitializationSettled) return;
      soundInitializationSettled = true;
      setEngineStatus("error");
      setEngineProgress(0);
      setStatusMessage("Sound map unavailable · using the studio demo pack");
      recordResearch({
        type: "engine",
        engine: "sound",
        phase: "error",
        durationMs: Math.round(performance.now() - soundStartedAt.current),
      });
    };

    void import("../lib/phonetic-search").then((phoneticModule) => {
      if (cancelled) return;
      const phonetic = phoneticModule.createPhoneticSearchClient();
      phoneticRef.current = phonetic;
      unsubscribePhonetic = phonetic.subscribe((event) => {
        if (event.type === "progress") {
          setEngineProgress(Math.round(event.progress * 100));
          if (event.stage !== "searching") setStatusMessage("Preparing local pronunciation map");
        } else if (event.type === "ready") {
          soundInitializationSettled = true;
          setEngineStatus("ready");
          setLexiconCount(event.words);
          setEngineProgress(100);
          setStatusMessage("Sound map ready");
          recordResearch({
            type: "engine",
            engine: "sound",
            phase: "ready",
            durationMs: Math.round(performance.now() - soundStartedAt.current),
            itemCount: event.words,
          });
        }
      });
      void phonetic.init().catch(failSoundInitialization);
    }).catch(failSoundInitialization);

    return () => {
      cancelled = true;
      unsubscribePhonetic();
      phoneticRef.current?.dispose();
      phoneticRef.current = null;
    };
  }, [recordResearch]);

  const releaseSemantic = useCallback(() => {
    hybridSearchRevision.current += 1;
    semanticLifecycleRevision.current += 1;
    if (semanticAttemptRef.current) semanticAttemptRef.current.settled = true;
    semanticUnsubscribeRef.current();
    semanticUnsubscribeRef.current = () => {};
    semanticRef.current?.dispose();
    semanticRef.current = null;
    semanticAttemptRef.current = null;
  }, []);

  const startSemantic = useCallback(async (trigger: SemanticTrigger) => {
    if (semanticRef.current || semanticStatus === "loading" || semanticStatus === "ready") return;
    const revision = ++semanticLifecycleRevision.current;
    const startedAt = performance.now();
    semanticAttemptRef.current = { revision, startedAt, settled: false };
    setSemanticStatus("loading");
    setStatusMessage(`Loading meaning model locally · ${SEMANTIC_DOWNLOAD_LABEL}`);
    recordResearch({ type: "engine", engine: "meaning", phase: "started", trigger });

    const fail = () => {
      if (revision !== semanticLifecycleRevision.current) return;
      const attempt = semanticAttemptRef.current;
      if (attempt && !attempt.settled) {
        attempt.settled = true;
        recordResearch({
          type: "engine",
          engine: "meaning",
          phase: "error",
          trigger,
          durationMs: Math.round(performance.now() - attempt.startedAt),
        });
      }
      setSemanticStatus("error");
      setStatusMessage("Meaning unavailable · sound search is still ready");
    };

    try {
      const semanticModule = await import("../lib/semantic");
      if (revision !== semanticLifecycleRevision.current) return;
      const semantic = semanticModule.createSemanticClient();
      semanticRef.current = semantic;
      semanticUnsubscribeRef.current = semantic.subscribe((event) => {
        if (revision !== semanticLifecycleRevision.current) return;
        if (event.type === "ready") {
          const attempt = semanticAttemptRef.current;
          if (attempt && !attempt.settled) {
            attempt.settled = true;
            recordResearch({
              type: "engine",
              engine: "meaning",
              phase: "ready",
              trigger,
              durationMs: Math.round(performance.now() - attempt.startedAt),
            });
          }
          setSemanticStatus("ready");
          setStatusMessage("Meaning ready · everything stays on this device");
        } else if (event.type === "error" && event.requestId === 0) {
          fail();
        }
      });
      await semantic.init();
    } catch {
      fail();
    }
  }, [recordResearch, semanticStatus]);

  const enableSemantic = useCallback((trigger: SemanticTrigger) => {
    pendingSemanticTrigger.current = trigger;
    setSemanticEnabled(true);
    try {
      window.localStorage.setItem(SEMANTIC_PREFERENCE_KEY, "true");
    } catch {
      // The in-memory preference still works for this session.
    }
  }, []);

  const disableSemantic = useCallback(() => {
    releaseSemantic();
    setSemanticEnabled(false);
    setSemanticStatus("idle");
    if (baseCandidatesRevision === soundSearchRevision.current) {
      setCandidates(baseCandidates);
    }
    setStatusMessage("Meaning off · sound search stays ready");
    try {
      window.localStorage.setItem(SEMANTIC_PREFERENCE_KEY, "false");
    } catch {
      // The in-memory preference still works for this session.
    }
    recordResearch({ type: "engine", engine: "meaning", phase: "disabled" });
  }, [baseCandidates, baseCandidatesRevision, recordResearch, releaseSemantic]);

  const retrySemantic = useCallback(() => {
    releaseSemantic();
    setSemanticStatus("idle");
    pendingSemanticTrigger.current = "retry";
    setSemanticEnabled(true);
    void startSemantic("retry");
  }, [releaseSemantic, startSemantic]);

  useEffect(() => {
    if (!hydrated || !semanticEnabled || semanticStatus !== "idle") return;
    void startSemantic(pendingSemanticTrigger.current);
  }, [hydrated, semanticEnabled, semanticStatus, startSemantic]);

  useEffect(() => {
    return () => releaseSemantic();
  }, [releaseSemantic]);

  const applyHybridSearch = useCallback(
    async (
      query: string,
      source: CandidateView[],
      baseRevision: number,
      hybridRevision: number,
    ) => {
      const semantic = semanticRef.current;
      const phonetic = phoneticRef.current;
      if (!semantic || !phonetic || semanticStatus !== "ready" || source.length === 0 || !query.trim()) return;
      const isCurrentGeneration = () => (
        baseRevision === soundSearchRevision.current
        && hybridRevision === hybridSearchRevision.current
        && semanticRef.current === semantic
      );
      if (!isCurrentGeneration()) return;
      if (meaningBalance <= 0) {
        setCandidates(source);
        setStatusMessage("Sound-only neighbourhood restored");
        return;
      }
      try {
        const anchors = [...new Set([anchor, ...pins])].slice(0, 5);
        const excluded = [...new Set([...anchors, ...breadcrumbs.slice(0, -1)])];
        setStatusMessage("Searching the whole local meaning map");
        const retrieval = await semantic.retrieve(query, {
          limit: 160,
          exclude: excluded,
        });
        if (!isCurrentGeneration()) return;
        const policy = createHybridSearchPolicy({
          intent,
          meaningMix: meaningBalance,
          reach: adventurousness / 100,
          semanticHits: retrieval.hits,
        });
        const results = await phonetic.search({
          anchors,
          intent,
          limit: 120,
          minPhonetic: policy.minPhonetic,
          reach: adventurousness / 100,
          dialect,
          exclude: breadcrumbs.slice(0, -1),
          semanticScores: policy.semanticScores,
          weights: policy.weights,
        });
        if (!isCurrentGeneration()) return;
        const semanticByTerm = new Map(
          retrieval.hits.map((hit) => [normalizeCandidateText(hit.text), hit]),
        );
        const mapped = results.map(fromSearchCandidate).map((candidate) => {
          const hit = semanticByTerm.get(normalizeCandidateText(candidate.word));
          if (!hit) return candidate;
          const semanticReason = `meaning strength · ${Math.round(hit.fusionScore * 100)} corpus-scaled`;
          return {
            ...candidate,
            definition: hit.definition ?? candidate.definition,
            reasons: [...new Set([semanticReason, ...candidate.reasons])].slice(0, 4),
          };
        });
        setCandidates(mapped.length > 0 ? mapped : source);
        setSelectedId((current) =>
          mapped.some((candidate) => candidate.id === current)
            ? current
            : (mapped[0]?.id ?? source[0]?.id ?? ""),
        );
        setStatusMessage(
          `Sound + meaning searched across ${retrieval.index.count.toLocaleString("en-GB")} local terms`,
        );
      } catch (error) {
        if (!isCurrentGeneration()) return;
        const superseded = error instanceof Error && (
          error.name === "SemanticRequestSupersededError" || error.message.toLowerCase().includes("superseded")
        );
        if (!superseded) {
          setSemanticStatus("error");
          setCandidates(source);
          setStatusMessage("Meaning search paused · sound results restored");
          recordResearch({ type: "engine", engine: "meaning", phase: "error" });
        }
      }
    },
    [adventurousness, anchor, breadcrumbs, dialect, intent, meaningBalance, pins, recordResearch, semanticStatus],
  );

  useEffect(() => {
    const revision = ++soundSearchRevision.current;
    hybridSearchRevision.current += 1;
    semanticRerankInputRef.current = null;
    const phonetic = phoneticRef.current;
    if (!phonetic || engineStatus === "loading") return;

    if (!anchor.trim()) {
      const emptyTimer = window.setTimeout(() => {
        if (revision !== soundSearchRevision.current) return;
        setBaseCandidates([]);
        setBaseCandidatesRevision(revision);
        setCandidates([]);
        setSelectedId("");
        setSearching(false);
        setStatusMessage("Select a word in the draft to explore");
      }, 0);
      return () => window.clearTimeout(emptyTimer);
    }

    const timer = window.setTimeout(() => {
      const anchors = [...new Set([anchor, ...pins])].slice(0, 5);
      const activeLine = getActiveLine(draft, anchorRange);
      const query = intent === "bridge" && concept.trim()
        ? `${concept.trim()}. ${activeLine}`
        : activeLine;
      setSearching(true);
      setStatusMessage("Tracing the next neighbourhood");
      const minPhonetic = clamp(.42 - adventurousness * .0024, .18, .42);
      const searchStartedAt = performance.now();
      void phonetic
        .search({
          anchors,
          intent,
          limit: 96,
          minPhonetic,
          reach: adventurousness / 100,
          dialect,
          exclude: breadcrumbs.slice(0, -1),
          weights: {
            sound: .92,
            meaning: 0,
            utility: .08,
          },
        })
        .then((results) => {
          if (revision !== soundSearchRevision.current) return;
          if (results.length === 0) {
            setBaseCandidates([]);
            setBaseCandidatesRevision(revision);
            setCandidates([]);
            setSelectedId("");
            setStatusMessage(`No local pronunciation found for “${anchor}”`);
            return;
          }
          const mapped = results.map(fromSearchCandidate);
          recordResearch({
            type: "neighbourhood",
            intent,
            anchorCount: anchors.length,
            resultCount: mapped.length,
            durationMs: Math.round(performance.now() - searchStartedAt),
          });
          setBaseCandidates(mapped);
          setBaseCandidatesRevision(revision);
          setCandidates(mapped);
          setSemanticQuery(query);
          setSelectedId((current) =>
            mapped.some((candidate) => candidate.id === current) ? current : mapped[0].id,
          );
          setStatusMessage(`${mapped.length} local neighbours found`);
        })
        .catch((error: unknown) => {
          if (revision !== soundSearchRevision.current) return;
          if (error instanceof Error && error.message.includes("superseded")) return;
          setEngineStatus("error");
          setStatusMessage("Using the studio demo pack");
        })
        .finally(() => {
          if (revision === soundSearchRevision.current) setSearching(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [anchor, pins, intent, concept, adventurousness, dialect, draft, anchorRange, breadcrumbs, engineStatus, recordResearch]);

  useEffect(() => {
    const hybridRevision = ++hybridSearchRevision.current;
    if (
      semanticStatus !== "ready"
      || baseCandidates.length === 0
      || baseCandidatesRevision !== soundSearchRevision.current
    ) return;
    const previous = semanticRerankInputRef.current;
    const onlyMixChanged = Boolean(
      previous &&
      previous.source === baseCandidates &&
      previous.query === semanticQuery &&
      previous.status === semanticStatus,
    );
    semanticRerankInputRef.current = {
      source: baseCandidates,
      query: semanticQuery,
      status: semanticStatus,
    };
    const timer = window.setTimeout(() => {
      void applyHybridSearch(
        semanticQuery,
        baseCandidates,
        baseCandidatesRevision,
        hybridRevision,
      );
    }, meaningBalance <= 0 ? 0 : onlyMixChanged ? 240 : 0);
    return () => window.clearTimeout(timer);
  }, [
    semanticStatus,
    baseCandidates,
    baseCandidatesRevision,
    semanticQuery,
    meaningBalance,
    applyHybridSearch,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
      setUndoState(null);
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const captureAnchor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    let nextAnchor = draft.slice(start, end).trim();
    if (!nextAnchor) {
      const found = wordAtCursor(draft, start);
      nextAnchor = found.text;
      start = found.start;
      end = found.end;
    } else {
      const leading = draft.slice(start, end).indexOf(nextAnchor);
      start += Math.max(0, leading);
      end = start + nextAnchor.length;
    }
    if (!nextAnchor || nextAnchor.length > 48) return;
    setAnchor(nextAnchor);
    setAnchorRange({ start, end });
    setBreadcrumbs([nextAnchor]);
    setPins([]);
    setMobilePanel("explore");
    recordResearch({ type: "anchor", anchor: nextAnchor, source: "draft" });
  }, [draft, recordResearch]);

  const togglePin = useCallback((word: string) => {
    const wasPinned = pins.includes(word);
    if (!wasPinned && pins.length >= MAX_PIN_COUNT) {
      setToast("A rhyme family can hold five anchors total");
      return;
    }
    const candidate = candidates.find((item) => item.word === word);
    recordResearch({
      type: "candidate",
      action: wasPinned ? "unpinned" : "pinned",
      candidate: word,
      anchor,
      intent,
      rank: candidate ? candidates.indexOf(candidate) + 1 : undefined,
      relation: candidate?.relation,
    });
    setPins(wasPinned ? pins.filter((item) => item !== word) : [...pins, word]);
  }, [anchor, candidates, intent, pins, recordResearch]);

  const expandCandidate = useCallback((candidate: CandidateView) => {
    recordResearch({
      type: "candidate",
      action: "expanded",
      candidate: candidate.word,
      anchor,
      intent,
      rank: candidates.indexOf(candidate) + 1,
      relation: candidate.relation,
    });
    recordResearch({ type: "anchor", anchor: candidate.word, source: "candidate" });
    setAnchor(candidate.word);
    setBreadcrumbs((current) => [...current, candidate.word].slice(-6));
    setSelectedId(candidate.id);
    setToast(`Opened the ${candidate.word} neighbourhood`);
  }, [anchor, candidates, intent, recordResearch]);

  const insertCandidate = useCallback((candidate: CandidateView) => {
    const before = draft;
    const rangeIsUsable =
      anchorRange.start >= 0 &&
      anchorRange.end <= draft.length &&
      anchorRange.start < anchorRange.end &&
      draft.slice(anchorRange.start, anchorRange.end).trim().length > 0;
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const fallback = wordAtCursor(draft, caret);
    const range = rangeIsUsable
      ? anchorRange
      : { start: fallback.start, end: fallback.end };
    const selectedText = draft.slice(range.start, range.end);
    const preserveCapital = /^[A-Z]/.test(selectedText);
    const insertion = preserveCapital
      ? candidate.word.charAt(0).toUpperCase() + candidate.word.slice(1)
      : candidate.word;
    const nextDraft = `${draft.slice(0, range.start)}${insertion}${draft.slice(range.end)}`;
    const nextRange = { start: range.start, end: range.start + insertion.length };
    setUndoState({
      draft: before,
      range,
      anchor,
      breadcrumbs: [...breadcrumbs],
      inserted: candidate.word,
      relation: candidate.relation,
      rank: candidates.indexOf(candidate) + 1,
      intent,
    });
    setDraft(nextDraft);
    setAnchor(candidate.word);
    setAnchorRange(nextRange);
    setBreadcrumbs((current) => [...current, candidate.word].slice(-6));
    setToast(`Inserted “${candidate.word}”`);
    recordResearch({
      type: "candidate",
      action: "inserted",
      candidate: candidate.word,
      anchor,
      intent,
      rank: candidates.indexOf(candidate) + 1,
      relation: candidate.relation,
    });
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextRange.start, nextRange.end);
    }, 0);
  }, [anchor, anchorRange, breadcrumbs, candidates, draft, intent, recordResearch]);

  const undoInsert = useCallback(() => {
    if (!undoState) return;
    setDraft(undoState.draft);
    setAnchor(undoState.anchor);
    setAnchorRange(undoState.range);
    setBreadcrumbs(undoState.breadcrumbs);
    recordResearch({
      type: "candidate",
      action: "undone",
      candidate: undoState.inserted,
      anchor: undoState.anchor,
      intent: undoState.intent,
      rank: undoState.rank,
      relation: undoState.relation,
    });
    setUndoState(null);
    setToast("Insertion undone");
  }, [recordResearch, undoState]);

  const selectCandidate = useCallback((candidate: CandidateView) => {
    setSelectedId(candidate.id);
    setDetailsOpen(true);
    recordResearch({
      type: "candidate",
      action: "selected",
      candidate: candidate.word,
      anchor,
      intent,
      rank: candidates.indexOf(candidate) + 1,
      relation: candidate.relation,
    });
  }, [anchor, candidates, intent, recordResearch]);

  const chooseIntent = useCallback((nextIntent: Intent) => {
    setIntent(nextIntent);
    recordResearch({ type: "intent", intent: nextIntent });
    if (nextIntent === "bridge") enableSemantic("bridge");
  }, [enableSemantic, recordResearch]);

  const chooseView = useCallback((nextView: ResultView) => {
    setViewMode(nextView);
    if (nextView === "map" || nextView === "list") {
      recordResearch({ type: "view", view: nextView });
    }
  }, [recordResearch]);

  const updateMeaningBalance = useCallback((value: number) => {
    setMeaningBalance(value);
    if (value > 0 && !semanticEnabled) enableSemantic("mix");
  }, [enableSemantic, semanticEnabled]);

  const startResearch = useCallback(() => {
    try {
      const session = createLocalResearchSession();
      researchRef.current = session;
      setResearchActive(true);
      setToast("Local research session started · activity is now recorded in this tab");
    } catch {
      setToast("Research sessions are unavailable in this browser");
    }
  }, []);

  const exportResearch = useCallback(() => {
    try {
      const session = researchRef.current;
      if (!session) {
        setToast("Start a local research session before exporting");
        return;
      }
      session.record({ type: "export" });
      const snapshot = session.snapshot({
        anchor,
        pinnedAnchors: pins,
        concept: intent === "bridge" && concept.trim() ? concept : undefined,
        intent,
        meaningMix: meaningBalance,
        adventurousness,
        meaningState: semanticStatus,
        dialect,
      });
      downloadResearchSession(snapshot);
      setToast("Research session exported · no draft text included");
    } catch {
      setToast("Research export is unavailable in this browser");
    }
  }, [adventurousness, anchor, concept, dialect, intent, meaningBalance, pins, semanticStatus]);

  const stopResearch = useCallback(() => {
    let cleared = true;
    try {
      researchRef.current?.clear();
    } catch {
      cleared = false;
    }
    researchRef.current = null;
    setResearchActive(false);
    setToast(cleared
      ? "Research session cleared and stopped"
      : "Research stopped, but stored session data could not be confirmed cleared");
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    window.requestAnimationFrame(() => settingsCloseButtonRef.current?.focus());
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSettings();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeSettings, settingsOpen]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z" &&
        undoState &&
        toast?.startsWith("Inserted")
      ) {
        event.preventDefault();
        undoInsert();
        return;
      }
      if (typing || !selected) return;
      if (event.key.toLowerCase() === "p") togglePin(selected.word);
      if (event.key.toLowerCase() === "e") expandCandidate(selected);
      if (event.key.toLowerCase() === "i") insertCandidate(selected);
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [expandCandidate, insertCandidate, selected, togglePin, toast, undoInsert, undoState]);

  const lines = draft.split("\n");
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand" aria-label="RhymeGraph">
          <span className="brand-mark"><Network size={17} strokeWidth={2.2} /></span>
          <span className="brand-rhyme">RHYME</span>
          <span className="brand-slash">/</span>
          <span>GRAPH</span>
          <span className="alpha-badge">ALPHA</span>
        </div>

        <label className="project-name">
          <span className="sr-only">Project name</span>
          <input maxLength={MAX_TITLE_LENGTH} value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
        </label>

        <div className="topbar-actions">
          <span
            className={`save-state save-state-${saveStatus}`}
            role="status"
            aria-live="polite"
          >
            {saveStatus === "saved" && <Check size={13} />}
            {saveStatus === "error" && <CircleAlert size={13} />}
            {saveStatus === "saved"
              ? "Saved on this device"
              : saveStatus === "error"
                ? "Not saved on this device"
                : "Checking local save"}
          </span>
          <button
            className="dialect-button"
            type="button"
            aria-label={`Pronunciation profile: ${dialect === "en-GB" ? "UK non-rhotic beta" : "General American"}. Switch profile`}
            title="Switch the pronunciation profile used for rhyme scoring"
            onClick={() => {
              const next = dialect === "en-GB" ? "en-US" : "en-GB";
              setDialect(next);
              setToast(next === "en-GB"
                ? "UK non-rhotic profile · conservative beta transform"
                : "General American pronunciation profile");
            }}
          >
            <span>{dialect === "en-GB" ? "UK non-rhotic · beta" : "General American"}</span><ChevronDown size={14} />
          </button>
          <button
            className="icon-button perform-button"
            type="button"
            aria-label="Open performed cadence preview"
            onClick={() => {
              setVoiceNoteOpen((open) => !open);
              setSettingsOpen(false);
            }}
          >
            <Mic2 size={17} />
          </button>
          <button
            ref={settingsButtonRef}
            className="icon-button"
            type="button"
            aria-label="Open local settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              if (settingsOpen) {
                closeSettings();
                return;
              }
              setSettingsOpen(true);
              setVoiceNoteOpen(false);
            }}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      {voiceNoteOpen && (
        <aside className="voice-note" aria-label="Performed cadence preview">
          <div className="voice-note-icon"><Gauge size={19} /></div>
          <div>
            <strong>Performed cadence is the next layer.</strong>
            <p>Soon you’ll be able to rap the line and search for words that fit the pocket you actually performed.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => setVoiceNoteOpen(false)}><X size={15} /></button>
        </aside>
      )}

      {settingsOpen && (
        <aside className="local-settings" aria-label="Local intelligence and research settings">
          <header>
            <div>
              <span>LOCAL SETTINGS</span>
              <strong>Local by design</strong>
            </div>
            <button ref={settingsCloseButtonRef} type="button" aria-label="Close local settings" onClick={closeSettings}><X size={15} /></button>
          </header>

          <section className="local-settings-card" data-semantic-state={semanticStatus}>
            <div className="settings-card-heading">
              <span className="settings-card-icon"><BrainCircuit size={16} /></span>
              <div>
                <strong>Meaning model</strong>
                <span>{SEMANTIC_DOWNLOAD_LABEL} once · runs on this device</span>
              </div>
            </div>
            {semanticStatus === "loading" && (
              <div
                className="semantic-progress"
                role="progressbar"
                aria-label="Meaning model loading"
                aria-valuetext={`Loading locally · ${SEMANTIC_DOWNLOAD_LABEL}`}
              >
                <span />
              </div>
            )}
            <p>
              {semanticStatus === "ready"
                ? "Meaning is active. Sound remains available if you turn it off."
                : semanticStatus === "loading"
                  ? `Loading locally · ${SEMANTIC_DOWNLOAD_LABEL}`
                  : semanticStatus === "error"
                    ? "Meaning could not start. Sound search is unaffected."
                    : "Optional. It loads only when you ask for meaning or choose Bridge."}
            </p>
            <button
              className="settings-card-action"
              type="button"
              aria-label={semanticStatus === "idle" ? "Load meaning model" : semanticStatus === "error" ? "Reload meaning model" : "Turn off meaning model"}
              onClick={semanticStatus === "idle" ? () => enableSemantic("control") : semanticStatus === "error" ? retrySemantic : disableSemantic}
            >
              {semanticStatus === "idle" ? `Enable · ${SEMANTIC_DOWNLOAD_LABEL}` : semanticStatus === "error" ? "Try again" : semanticStatus === "loading" ? "Cancel download" : "Use sound only"}
            </button>
            {semanticStatus === "error" && (
              <button className="settings-card-action" type="button" aria-label="Turn off failed meaning model" onClick={disableSemantic}>
                Use sound only
              </button>
            )}
          </section>

          <section className="local-settings-card research-card">
            <div className="settings-card-heading">
              <span className="settings-card-icon research-icon"><Download size={16} /></span>
              <div>
                <strong>Research session</strong>
                <span>{researchActive ? "Recording in this tab" : "Off until you start it"}</span>
              </div>
            </div>
            <p>
              {researchActive
                ? "Recording anchors, concepts, candidate actions, settings, and timings locally in this tab. Your full draft and project title are excluded. Nothing is uploaded."
                : "Start only if you want to record anchors, concepts, candidate actions, settings, and timings locally in this tab. Your full draft and project title are excluded. Nothing is uploaded."}
            </p>
            {researchActive ? (
              <div className="research-actions">
                <button className="settings-card-action" type="button" aria-label="Export research session" onClick={exportResearch}>
                  <Download size={13} /> Export research session
                </button>
                <button className="settings-card-action research-stop" type="button" onClick={stopResearch}>
                  Clear &amp; stop
                </button>
              </div>
            ) : (
              <button className="settings-card-action" type="button" onClick={startResearch}>
                Start local research session
              </button>
            )}
          </section>

          <p className="settings-privacy"><span className="local-dot" /> No remote analytics or account. Research data is never uploaded. On GitHub Pages, browser storage shares the <code>sjmakin.github.io</code> origin with other project pages.</p>
        </aside>
      )}

      <div className="mobile-tabs" role="group" aria-label="Workspace view">
        <button type="button" className={mobilePanel === "write" ? "active" : ""} aria-pressed={mobilePanel === "write"} onClick={() => setMobilePanel("write")}>
          <BookOpen size={16} /> Write
        </button>
        <button type="button" className={mobilePanel === "explore" ? "active" : ""} aria-pressed={mobilePanel === "explore"} onClick={() => setMobilePanel("explore")}>
          <Network size={16} /> Explore
        </button>
      </div>

      <section
        className={`workspace ${exploreFocused ? "explore-focused" : ""} ${detailsOpen ? "candidate-details-open" : ""}`}
      >
        <section className={`panel draft-panel ${mobilePanel === "write" ? "mobile-active" : ""}`} aria-label="Draft">
          <div className="panel-header draft-header">
            <div>
              <span className="eyebrow">DRAFT</span>
              <span className="draft-status">Verse 01</span>
            </div>
            <button className="small-icon-button" type="button" title="Draft history"><History size={15} /></button>
          </div>

          <div className="anchor-toolbar">
            <div className="anchor-token">
              <span>ANCHOR</span>
              <strong>{anchor || "select a word"}</strong>
              <button type="button" aria-label="Clear anchor" onClick={() => setAnchor("")}><X size={12} /></button>
            </div>
            <button className="text-action" type="button" onClick={captureAnchor}><Focus size={13} /> Explore selection</button>
          </div>

          <div className="editor-wrap">
            <div className="line-numbers" aria-hidden="true">
              {lines.map((unused, index) => <span key={index}>{String(index + 1).padStart(2, "0")}</span>)}
            </div>
            <textarea
              ref={textareaRef}
              maxLength={MAX_DRAFT_LENGTH}
              value={draft}
              onChange={(event) => {
                const nextDraft = event.target.value;
                const cursor = event.target.selectionStart;
                let found = wordAtCursor(nextDraft, cursor);
                if (!found.text && cursor > 0) found = wordAtCursor(nextDraft, cursor - 1);
                setDraft(nextDraft);
                setUndoState(null);
                if (toast?.startsWith("Inserted")) setToast(null);
                setAnchor(found.text);
                setAnchorRange({ start: found.start, end: found.end });
                setBreadcrumbs(found.text ? [found.text] : []);
              }}
              onMouseUp={captureAnchor}
              onKeyUp={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key.startsWith("Arrow") || event.key === "Shift") captureAnchor();
              }}
              spellCheck={false}
              aria-label="Lyric draft"
            />
          </div>

          <div className="draft-footer">
            <span><span className="local-dot" /> Local only · <a href={withBasePath("/notices/")}>Licences</a></span>
            <span>{wordCount} words · {lines.length} bars</span>
          </div>
        </section>

        <section className={`panel explore-panel ${mobilePanel === "explore" ? "mobile-active" : ""}`} aria-label="Explore rhymes">
          <div className="explore-toolbar">
            <div className="intent-tabs" role="tablist" aria-label="Recommendation intent">
              {(["continue", "bridge", "pivot"] as Intent[]).map((item) => (
                <button
                  key={item}
                  className={intent === item ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={intent === item}
                  onClick={() => chooseIntent(item)}
                >
                  {item === "continue" ? <CornerDownLeft size={14} /> : item === "bridge" ? <ArrowRight size={14} /> : <ArrowDownRight size={14} />}
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <div className="explore-toolbar-actions">
              <div className="view-switch" role="group" aria-label="Result view">
                <button type="button" className={viewMode === "family" ? "active" : ""} aria-pressed={viewMode === "family"} onClick={() => chooseView("family")} aria-label="Family view"><LayoutGrid size={14} /><span>Families</span></button>
                <button type="button" className={viewMode === "map" ? "active" : ""} aria-pressed={viewMode === "map"} onClick={() => chooseView("map")} aria-label="Map view"><MapIcon size={14} /><span>Map</span></button>
                <button type="button" className={viewMode === "list" ? "active" : ""} aria-pressed={viewMode === "list"} onClick={() => chooseView("list")} aria-label="List view"><List size={14} /><span>List</span></button>
              </div>
              <button
                className={`explore-focus-button ${exploreFocused ? "active" : ""}`}
                type="button"
                aria-pressed={exploreFocused}
                onClick={() => {
                  setExploreFocused((focused) => !focused);
                  setDetailsOpen(false);
                }}
              >
                {exploreFocused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                <span>{exploreFocused ? "Show draft" : "Focus"}</span>
              </button>
            </div>
          </div>

          {intent === "bridge" && (
            <label className="concept-field">
              <Sparkles size={14} />
              <span>means like</span>
              <input
                value={concept}
                onChange={(event) => setConcept(event.target.value)}
                onBlur={() => {
                  if (concept.trim()) recordResearch({ type: "concept", concept });
                }}
                placeholder="quiet, escape, home…"
              />
              <span className="on-device">on device</span>
            </label>
          )}

          <div className="mix-controls">
            <label className="mix-control">
              <span className="control-name">Meaning</span>
              <input
                type="range"
                min="0"
                max="100"
                value={effectiveMeaningBalance}
                disabled={semanticStatus === "loading" || semanticStatus === "error"}
                onChange={(event) => updateMeaningBalance(Number(event.target.value))}
                onPointerUp={() => recordResearch({ type: "meaning_mix", value: meaningBalance })}
                onKeyUp={() => recordResearch({ type: "meaning_mix", value: meaningBalance })}
                aria-label="Balance sound and meaning"
                aria-valuetext={`${meaningControlState}, ${effectiveMeaningBalance}% mix position`}
              />
              <strong className="control-state">{meaningControlState}</strong>
            </label>
            <label className="mix-control tightness-control">
              <span className="control-name">Reach</span>
              <input
                type="range"
                min="0"
                max="100"
                value={adventurousness}
                onChange={(event) => setAdventurousness(Number(event.target.value))}
                aria-label="Rhyme adventurousness"
                aria-valuetext={`${reachState(adventurousness)}, ${adventurousness}% reach`}
              />
              <strong className="control-state">{reachState(adventurousness)}</strong>
            </label>
            <button className={`filter-button ${advancedOpen ? "active" : ""}`} type="button" onClick={() => setAdvancedOpen((open) => !open)}>
              <SlidersHorizontal size={15} /> Filters
            </button>
          </div>

          {advancedOpen && (
            <div className="advanced-filters">
              <label>Syllables
                <select value={syllableFilter} onChange={(event) => setSyllableFilter(event.target.value)}>
                  <option value="any">Any</option>
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4+</option>
                </select>
              </label>
              <label>Part of speech
                <select value={partOfSpeech} onChange={(event) => setPartOfSpeech(event.target.value)}>
                  <option value="any">Any</option><option value="noun">Noun</option><option value="verb">Verb</option><option value="adjective">Adjective</option><option value="adverb">Adverb</option>
                </select>
              </label>
              <div className="filter-note"><CircleHelp size={14} /> Filters refill from the whole retrieved neighbourhood.</div>
            </div>
          )}

          <div className="engine-status" aria-live="polite">
            <span><EngineDot status={engineStatus} /> {engineStatus === "ready" ? `${lexiconCount.toLocaleString()} terms local` : engineStatus === "error" ? "sound map unavailable" : `${engineProgress}% sound map`}</span>
            <span className="semantic-engine" data-semantic-state={semanticStatus}>
              <EngineDot status={semanticStatus} />
              <span>
                {semanticStatus === "ready"
                  ? "meaning ready"
                  : semanticStatus === "error"
                    ? "meaning unavailable"
                    : semanticStatus === "loading"
                      ? `loading locally · ${SEMANTIC_DOWNLOAD_LABEL}`
                      : `meaning off · ${SEMANTIC_DOWNLOAD_LABEL} optional`}
              </span>
              <button
                type="button"
                aria-label={semanticStatus === "idle" ? "Enable meaning" : semanticStatus === "error" ? "Retry meaning" : "Disable meaning"}
                onClick={semanticStatus === "idle" ? () => enableSemantic("control") : semanticStatus === "error" ? retrySemantic : disableSemantic}
              >
                {semanticStatus === "idle" ? "enable" : semanticStatus === "error" ? "retry" : semanticStatus === "loading" ? "cancel" : "disable"}
              </button>
              {semanticStatus === "error" && (
                <button type="button" aria-label="Disable meaning" onClick={disableSemantic}>off</button>
              )}
            </span>
            <span className={searching ? "searching" : ""}>{searching ? "updating…" : statusMessage}</span>
          </div>

          <div className={`graph-stage ${viewMode}-mode`}>
            {visibleCandidates.length === 0 ? (
              <div className="empty-results">
                <Search size={24} />
                <strong>{filtersActive ? "No neighbours match these filters." : "Nothing useful at this reach."}</strong>
                {filtersActive ? (
                  <button type="button" onClick={() => {
                    setSyllableFilter("any");
                    setPartOfSpeech("any");
                  }}>Clear filters</button>
                ) : (
                  <button type="button" onClick={() => setAdventurousness((value) => Math.min(100, value + 25))}>Go farther</button>
                )}
              </div>
            ) : viewMode === "family" ? (
              <div className="family-board" aria-label="Rhyme families">
                <div className="family-board-intro">
                  <strong>Choose a way in</strong>
                  <span>Words can sit in more than one family when several sounds connect.</span>
                </div>
                {familyGroups.map((group) => (
                  <section className={`family-channel family-${group.id}`} key={group.id} aria-labelledby={`family-${group.id}-title`}>
                    <header>
                      <div>
                        <h2 id={`family-${group.id}-title`}>{group.name}</h2>
                        <p>{group.description}</p>
                      </div>
                      <span>{group.total}</span>
                    </header>
                    <div className="family-cards">
                      {group.candidates.length > 0 ? group.candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className={`family-candidate ${candidate.id === selected?.id ? "active" : ""}`}
                          onClick={() => selectCandidate(candidate)}
                          aria-label={`${candidate.word}, ${candidate.overall} percent fit, ${group.name}. Open explanation`}
                        >
                          <span className="family-candidate-rank">{String(candidates.indexOf(candidate) + 1).padStart(2, "0")}</span>
                          <span className="family-candidate-word">{candidate.word}</span>
                          <strong>{candidate.overall}</strong>
                          <small>{familyEvidence(candidate, group.id)}</small>
                        </button>
                      )) : (
                        <p className="family-empty">No {group.shortName.toLowerCase()} options in this neighbourhood.</p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : viewMode === "map" ? (
              <>
                <span className="map-method-note">Actual candidate-to-candidate sound links</span>
                <svg className="graph-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {localGraph.edges.map((edge) => {
                    const source = edge.source === "__anchor__"
                      ? { x: 50, y: 50 }
                      : graphNodeById.get(edge.source);
                    const target = graphNodeById.get(edge.target);
                    if (!source || !target) return null;
                    const targetCandidate = visibleCandidates.find((candidate) => candidate.id === edge.target);
                    return (
                      <line
                        key={`${edge.kind}:${edge.source}:${edge.target}`}
                        x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                        className={edge.kind === "neighbour"
                          ? `neighbour-edge ${edge.source === selected?.id || edge.target === selected?.id ? "active" : ""}`
                          : `${targetCandidate ? RELATION_CLASS[targetCandidate.relation] : "relation-flow"} ${targetCandidate?.estimated ? "estimated" : ""}`}
                        style={{ strokeWidth: edge.kind === "neighbour" ? Math.max(.32, edge.weight * 1.05) : Math.max(.2, edge.weight * .7) }}
                      />
                    );
                  })}
                </svg>
                <button className="anchor-node" type="button" tabIndex={-1} aria-hidden="true">
                  <span>{anchor}</span>
                  <small>{pins.length > 0 ? `${pins.length + 1} anchors` : "sound anchor"}</small>
                </button>
                {visibleCandidates.map((candidate) => {
                  const position = graphNodeById.get(candidate.id) ?? { x: 50, y: 50 };
                  const active = candidate.id === selected?.id;
                  const pinned = pins.includes(candidate.word);
                  const style = {
                    "--node-x": `${position.x}%`,
                    "--node-y": `${position.y}%`,
                    "--node-accent": RELATION_ACCENT[candidate.relation],
                    "--node-scale": `${.88 + candidate.overall / 650}`,
                  } as CSSProperties;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-label={`${candidate.word}, ${candidate.overall} percent fit, ${RELATION_LABEL[candidate.relation]}`}
                      className={`graph-node ${active ? "active" : ""} ${pinned ? "pinned" : ""}`}
                      style={style}
                      onClick={() => selectCandidate(candidate)}
                      onDoubleClick={() => expandCandidate(candidate)}
                    >
                      <span>{candidate.word}</span>
                      <small>{candidate.overall}</small>
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="full-list">
                {visibleCandidates.map((candidate, index) => (
                  <button key={candidate.id} type="button" className={candidate.id === selected?.id ? "active" : ""} onClick={() => selectCandidate(candidate)}>
                    <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="result-word">{candidate.word}<small>{candidate.pronunciation}</small></span>
                    <span className={`relation-pill ${RELATION_CLASS[candidate.relation]}`}>{RELATION_LABEL[candidate.relation]}</span>
                    <strong>{candidate.overall}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>

          {viewMode === "map" && (
            <div className="candidate-rail" aria-label="Ranked candidates">
              {visibleCandidates.slice(0, 8).map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={candidate.id === selected?.id ? "active" : ""}
                  onClick={() => selectCandidate(candidate)}
                  aria-label={`${candidate.word}, ${candidate.overall} percent fit, ${RELATION_LABEL[candidate.relation]}`}
                >
                  <span className="rail-rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="rail-word">{candidate.word}</span>
                  <span className={`rail-relation ${RELATION_CLASS[candidate.relation]}`}>{RELATION_LABEL[candidate.relation]}</span>
                  <strong>{candidate.overall}</strong>
                </button>
              ))}
            </div>
          )}

          <div className="family-tray">
            <span className="family-label">FAMILY</span>
            <span className="pin-chip anchor-chip">{anchor}</span>
            {pins.map((word) => (
              <button key={word} className="pin-chip" type="button" onClick={() => togglePin(word)}>{word}<X size={11} /></button>
            ))}
            {pins.length === 0 && <span className="family-hint">Pin words to teach the sound</span>}
            <span className="family-summary">{pins.length > 0 ? "shared sound family" : "single anchor"}</span>
          </div>
          {selected && (
            <div className="mobile-candidate-actions">
              <span><strong>{selected.word}</strong><small>{selected.overall}% · {RELATION_LABEL[selected.relation]}</small></span>
              <button type="button" onClick={() => setDetailsOpen(true)} aria-label={`Explain ${selected.word}`}><CircleHelp size={15} /></button>
              <button type="button" onClick={() => togglePin(selected.word)} aria-label={`Pin ${selected.word}`}><Pin size={15} /></button>
              <button type="button" onClick={() => expandCandidate(selected)} aria-label={`Expand ${selected.word}`}><Network size={15} /></button>
              <button className="mobile-insert" type="button" onClick={() => insertCandidate(selected)}>Insert <CornerDownLeft size={15} /></button>
            </div>
          )}
        </section>

        <aside className="panel inspector-panel" aria-label="Candidate inspector">
          {selected ? (
            <>
              <div className="inspector-topline">
                <span className={`relation-pill ${RELATION_CLASS[selected.relation]}`}>{RELATION_LABEL[selected.relation]}</span>
                <div className="inspector-topline-actions">
                  <span>{selected.overall}% route fit</span>
                  <button type="button" className="inspector-close" aria-label="Close candidate details" onClick={() => setDetailsOpen(false)}><X size={14} /></button>
                </div>
              </div>
              <div className="word-heading">
                <h1>{selected.word}</h1>
                <button type="button" aria-label={`Hear ${selected.word}`} title="Pronunciation audio is coming next"><Volume2 size={17} /></button>
              </div>
              <code className="pronunciation">{selected.pronunciation}</code>
              <p className="definition">{selected.definition}</p>

              <div className="reason-chips">
                {selected.reasons.slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
              </div>

              <div className="score-card">
                <div className="score-card-title"><span>FIT BREAKDOWN</span><span>0—100</span></div>
                <ScoreBar label="Sound" value={selected.sound} tone="var(--accent-amber)" />
                <ScoreBar
                  label={semanticStatus === "ready" ? "Meaning" : "Meaning (off)"}
                  value={semanticStatus === "ready" ? selected.meaning : 0}
                  tone="var(--accent-lilac)"
                />
                <ScoreBar label="Stress shape" value={selected.flow} tone="var(--accent-coral)" />
                {semanticStatus === "ready" && (
                  <p className="score-note">Meaning is a corpus-calibrated similarity, not a confidence score.</p>
                )}
              </div>

              <div className="candidate-meta">
                <span><strong>{selected.syllables}</strong> syllables</span>
                <span><strong>{selected.phrase ? "phrase" : "word"}</strong> form</span>
                <span><strong>{selected.estimated ? "estimated" : "known"}</strong> sound</span>
              </div>

              <div className="primary-actions">
                <button className="insert-button" type="button" onClick={() => insertCandidate(selected)}>
                  Insert <CornerDownLeft size={16} />
                </button>
                <button className={pins.includes(selected.word) ? "active" : ""} type="button" onClick={() => togglePin(selected.word)}>
                  <Pin size={15} /> {pins.includes(selected.word) ? "Pinned" : "Pin"}
                </button>
                <button type="button" onClick={() => expandCandidate(selected)}><Network size={15} /> Expand</button>
              </div>

              <div className="shortcut-note">
                <span><kbd>P</kbd> pin</span><span><kbd>E</kbd> expand</span><span><kbd>I</kbd> insert</span>
              </div>

              <div className="path-card">
                <div><span>TRAVERSE PATH</span><button type="button" onClick={() => setBreadcrumbs([anchor])}>Clear</button></div>
                <p>{breadcrumbs.map((crumb, index) => <span key={`${crumb}-${index}`}>{index > 0 && <ArrowRight size={11} />}{crumb}</span>)}</p>
              </div>
            </>
          ) : (
            <div className="inspector-empty"><Network size={22} /><p>Select a neighbour to inspect the connection.</p></div>
          )}
        </aside>
      </section>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {undoState && toast.startsWith("Inserted") && <button type="button" onClick={undoInsert}><RotateCcw size={13} /> Undo</button>}
          <button
            className="toast-close"
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setToast(null);
              setUndoState(null);
            }}
          ><X size={13} /></button>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {visibleCandidates.length} neighbours. {statusMessage}
      </div>
    </main>
  );
}
