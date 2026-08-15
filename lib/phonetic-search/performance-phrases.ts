import type { LexiconEntryInput, PronunciationInput } from "../phonetics";

/**
 * Short, authored building blocks for cross-word rhyme exploration. These are
 * ordinary phrases, not extracted lyrics or an n-gram corpus. Pronunciations
 * are composed from the checked-in word lexicon at worker start-up.
 */
export const PERFORMANCE_PHRASE_TEXTS = [
  "after hours",
  "back at it",
  "back garden",
  "bad habit",
  "bad timing",
  "bank statement",
  "bar staff",
  "best kept",
  "big picture",
  "black cab",
  "black magic",
  "blood pressure",
  "bread winner",
  "break even",
  "bright future",
  "broken promise",
  "burn notice",
  "bus stop",
  "calm water",
  "car park",
  "cash balance",
  "cash only",
  "city centre",
  "city limits",
  "clean money",
  "close call",
  "cold shoulder",
  "concrete jungle",
  "corner office",
  "corner shop",
  "corner seat",
  "council flat",
  "council house",
  "council tax",
  "credit limit",
  "dark matter",
  "day shift",
  "dead centre",
  "dirty laundry",
  "double meaning",
  "double trouble",
  "ends meet",
  "estate agent",
  "estate gate",
  "false prophet",
  "fast traffic",
  "final answer",
  "first class",
  "first person",
  "fresh pressure",
  "front room",
  "full circle",
  "get even",
  "getaway car",
  "glass ceiling",
  "gold chain",
  "good reason",
  "grey market",
  "hard labour",
  "hard times",
  "head teacher",
  "heavy weather",
  "hidden meaning",
  "high ceiling",
  "high street",
  "home owner",
  "ice cream",
  "keep talking",
  "last minute",
  "last orders",
  "last packet",
  "late payment",
  "light sleeper",
  "local legend",
  "long memory",
  "loud mouth",
  "love money",
  "low profile",
  "mad at me",
  "main stage",
  "major problem",
  "make money",
  "market road",
  "market stall",
  "midnight train",
  "minor detail",
  "morning after",
  "move different",
  "my people",
  "neon light",
  "night bus",
  "night fever",
  "night shift",
  "no comment",
  "no pressure",
  "noise complaint",
  "old habits",
  "open secret",
  "out of town",
  "paper trail",
  "park ranger",
  "pay rent",
  "phone box",
  "pirate radio",
  "plain clothes",
  "pocket money",
  "point blank",
  "post code",
  "private number",
  "pub garden",
  "quick trigger",
  "quiet evening",
  "raw talent",
  "real life",
  "red wine",
  "rent payment",
  "road closure",
  "rough justice",
  "round trip",
  "run deep",
  "rush hour",
  "same page",
  "second nature",
  "sharp answer",
  "short notice",
  "side street",
  "silver lining",
  "slow motion",
  "small fortune",
  "smoke signal",
  "sound system",
  "south london",
  "split decision",
  "sports centre",
  "stand tall",
  "stay ready",
  "still moving",
  "storm warning",
  "straight face",
  "talk proper",
  "third verse",
  "tower block",
  "train fare",
  "train station",
  "tube station",
  "under cover",
  "voice note",
  "white tee",
  "wine cellar",
  "word perfect",
  "work permit",
] as const;

function pronunciationTokens(pronunciation: LexiconEntryInput["pronunciations"][number]) {
  if (typeof pronunciation === "string") return pronunciation.trim().split(/\s+/);
  if (Array.isArray(pronunciation)) return [...pronunciation];
  const structured = pronunciation as PronunciationInput;
  return typeof structured.phonemes === "string"
    ? structured.phonemes.trim().split(/\s+/)
    : [...structured.phonemes];
}

export function composePerformancePhraseEntries(
  sourceEntries: readonly LexiconEntryInput[],
): LexiconEntryInput[] {
  const words = new Map(
    sourceEntries
      .filter((entry) => !entry.text.includes(" ") && entry.pronunciations.length > 0)
      .map((entry) => [entry.text.toLowerCase(), entry]),
  );
  const existing = new Set(sourceEntries.map((entry) => entry.text.toLowerCase()));
  const phrases: LexiconEntryInput[] = [];

  for (const text of PERFORMANCE_PHRASE_TEXTS) {
    if (existing.has(text)) continue;
    const components = text.split(" ").map((word) => words.get(word));
    if (components.some((entry) => !entry)) continue;
    const tokens: string[] = [];
    const wordStarts: number[] = [];
    for (const entry of components) {
      wordStarts.push(tokens.length);
      tokens.push(...pronunciationTokens(entry!.pronunciations[0]));
    }
    const averageUtility = components.reduce(
      (total, entry) => total + (entry!.frequency ?? .5),
      0,
    ) / components.length;
    const tags = new Set(["phrase", "authored-performance-phrase"]);
    if (components.some((entry) => entry!.tags?.includes("en-GB"))) tags.add("en-GB");
    phrases.push({
      text,
      pronunciations: [{ phonemes: tokens, wordStarts }],
      kind: "phrase",
      frequency: Math.max(.25, averageUtility * .84),
      tags: [...tags],
    });
  }

  return phrases;
}
