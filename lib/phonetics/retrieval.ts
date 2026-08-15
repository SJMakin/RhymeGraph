import { pronunciationForDialect } from "./dialect";
import type { PerformanceDialect, PhoneticItem, Pronunciation } from "./types";

const VOWEL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  IY: ["front-high"],
  IH: ["front-high", "front-mid"],
  EY: ["front-mid", "moving-front"],
  EH: ["front-mid", "front-open"],
  AE: ["front-open", "open"],
  AA: ["open", "back-open"],
  AO: ["back-open", "back-rounded"],
  OW: ["back-rounded", "moving-back"],
  UH: ["back-rounded", "back-high"],
  UW: ["back-high"],
  AH: ["central", "open"],
  ER: ["central-rhotic"],
  AY: ["moving-front", "open"],
  AW: ["moving-back", "open"],
  OY: ["moving-back", "back-rounded"],
};

const COARSE_VOWEL_FAMILY: Readonly<Record<string, string>> = {
  IY: "front-high", IH: "front-high",
  EY: "front", EH: "front", AE: "front", AY: "front",
  AA: "open", AH: "central", ER: "central",
  AO: "back", OW: "back", UH: "back", UW: "back", OY: "back", AW: "back",
};

// Retrieval should not lose useful near-homorganic consonants before the exact
// scorer sees them. In particular, voiced/unvoiced pairs such as V/F are a
// staple of loose performance rhyme (silver/pilfer).
const COARSE_CONSONANT_FAMILY: Readonly<Record<string, string>> = {
  P: "labial-stop", B: "labial-stop", M: "labial-nasal",
  F: "labial-fricative", V: "labial-fricative",
  TH: "dental-fricative", DH: "dental-fricative",
  T: "alveolar-stop", D: "alveolar-stop", N: "alveolar-nasal",
  S: "alveolar-fricative", Z: "alveolar-fricative",
  L: "liquid", R: "liquid",
  SH: "postalveolar", ZH: "postalveolar", CH: "postalveolar", JH: "postalveolar",
  Y: "glide", W: "glide",
  K: "velar-stop", G: "velar-stop", NG: "velar-nasal",
  HH: "glottal-fricative",
};

interface RetrievalChannels {
  vowelSuffixes: readonly string[];
  vowelFamilySuffixes: readonly string[];
  vowelFamilies: readonly string[];
  coda?: string;
  consonantSuffixes: readonly string[];
  consonantFamilySuffixes: readonly string[];
  stressSuffixes: readonly string[];
  vowelSketches: readonly string[];
}

function familySuffixKeys(vowels: readonly string[], length: number): string[] {
  if (vowels.length < length) return [];
  const families = vowels.slice(-length)
    .map((vowel) => COARSE_VOWEL_FAMILY[vowel] ?? vowel);
  return [`vf:${length}:${families.join("-")}`];
}

export interface RhymeRetrievalRequest {
  anchors: readonly PhoneticItem[];
  semanticTerms?: readonly string[];
  reach?: number;
  dialect?: PerformanceDialect;
}

export interface RhymeRetrievalIndex {
  readonly size: number;
  shortlist(request: RhymeRetrievalRequest): readonly PhoneticItem[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function suffixKey(prefix: string, symbols: readonly string[], length: number): string | undefined {
  if (symbols.length < length) return undefined;
  return `${prefix}:${length}:${symbols.slice(-length).join("-")}`;
}

function channelsForPronunciation(pronunciation: Pronunciation): RetrievalChannels {
  const vowels = pronunciation.phonemes.filter((phone) => phone.type === "vowel");
  const vowelSymbols = vowels.map((phone) => phone.symbol);
  const consonantSymbols = pronunciation.phonemes
    .filter((phone) => phone.type === "consonant")
    .map((phone) => phone.symbol);
  const finalVowelIndex = pronunciation.phonemes.findLastIndex((phone) => phone.type === "vowel");
  const codaSymbols = pronunciation.phonemes
    .slice(finalVowelIndex + 1)
    .filter((phone) => phone.type === "consonant")
    .map((phone) => phone.symbol);
  const stressSymbols = vowels.map((phone) => String(phone.stress ?? 0));
  const finalVowel = vowelSymbols.at(-1);
  const consonantFamilies = consonantSymbols.map(
    (consonant) => COARSE_CONSONANT_FAMILY[consonant] ?? consonant,
  );
  const recentVowels = vowelSymbols.slice(-3);
  const recentVowelFamilies = recentVowels.map(
    (vowel) => COARSE_VOWEL_FAMILY[vowel] ?? vowel,
  );
  const vowelSketches = recentVowels.length >= 3
    ? [
        `vx:3:${recentVowels[0]}-${recentVowels[2]}`,
        `vfx:3:${recentVowelFamilies[0]}-${recentVowelFamilies[2]}`,
      ]
    : [];
  return {
    vowelSuffixes: [1, 2, 3]
      .flatMap((length) => suffixKey("v", vowelSymbols, length) ?? []),
    vowelFamilySuffixes: [2]
      .flatMap((length) => familySuffixKeys(vowelSymbols, length)),
    vowelFamilies: finalVowel ? (VOWEL_FAMILIES[finalVowel] ?? [finalVowel]) : [],
    coda: codaSymbols.length > 0 ? `coda:${codaSymbols.join("-")}` : undefined,
    consonantSuffixes: [1, 2, 3]
      .flatMap((length) => suffixKey("c", consonantSymbols, length) ?? []),
    consonantFamilySuffixes: [2, 3]
      .flatMap((length) => suffixKey("cf", consonantFamilies, length) ?? []),
    stressSuffixes: [2, 3]
      .flatMap((length) => suffixKey("s", stressSymbols, length) ?? []),
    vowelSketches,
  };
}

function addToIndex(index: Map<string, number[]>, key: string, itemIndex: number): void {
  const values = index.get(key);
  if (values) values.push(itemIndex);
  else index.set(key, [itemIndex]);
}

function normalizedTerm(value: string): string {
  return value.toLowerCase().trim().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

export function createRhymeRetrievalIndex(items: readonly PhoneticItem[]): RhymeRetrievalIndex {
  const channels = new Map<string, number[]>();
  const familyChannels = new Map<string, number[]>();
  const byTerm = new Map<string, number>();
  const compareCommonness = (left: number, right: number) =>
    items[right].frequency - items[left].frequency ||
    (items[left].normalized < items[right].normalized
      ? -1
      : items[left].normalized > items[right].normalized ? 1 : 0);
  // Build every posting list in commonness order once. Sorting the vocabulary
  // once is substantially cheaper than sorting hundreds of overlapping rhyme
  // buckets independently during browser start-up.
  const commonItems = Array.from({ length: items.length }, (_, index) => index)
    .sort(compareCommonness);
  const phraseItems = commonItems.filter((itemIndex) => items[itemIndex].kind === "phrase");

  commonItems.forEach((itemIndex) => {
    const item = items[itemIndex];
    byTerm.set(item.normalized, itemIndex);
    const itemChannels = new Set<string>();
    const itemFamilies = new Set<string>();
    for (const pronunciation of item.pronunciations) {
      for (const indexedPronunciation of [
        pronunciation,
        pronunciationForDialect(pronunciation, "en-GB"),
      ]) {
        const signature = channelsForPronunciation(indexedPronunciation);
        signature.vowelSuffixes.forEach((key) => itemChannels.add(key));
        signature.vowelFamilySuffixes.forEach((key) => itemChannels.add(key));
        signature.consonantSuffixes.forEach((key) => itemChannels.add(key));
        signature.consonantFamilySuffixes.forEach((key) => itemChannels.add(key));
        signature.stressSuffixes.forEach((key) => itemChannels.add(key));
        signature.vowelSketches.forEach((key) => itemChannels.add(key));
        if (signature.coda) itemChannels.add(signature.coda);
        signature.vowelFamilies.forEach((family) => itemFamilies.add(family));
      }
    }
    itemChannels.forEach((key) => addToIndex(channels, key, itemIndex));
    itemFamilies.forEach((key) => addToIndex(familyChannels, key, itemIndex));
  });

  const shortlist = ({
    anchors,
    semanticTerms = [],
    reach = 0,
    dialect = "en-US",
  }: RhymeRetrievalRequest) => {
    const boundedReach = clamp01(reach);
    const broadCap = Math.round(1_100 + 1_300 * boundedReach);
    const preciseCap = Math.round(3_000 + 2_000 * boundedReach);
    const anchorScores: Map<number, number>[] = [];

    const add = (
      scores: Map<number, number>,
      index: Map<string, number[]>,
      key: string,
      weight: number,
      cap: number,
    ) => {
      const matches = index.get(key);
      if (!matches) return;
      for (let position = 0; position < Math.min(cap, matches.length); position += 1) {
        const itemIndex = matches[position];
        scores.set(itemIndex, (scores.get(itemIndex) ?? 0) + weight);
      }
    };

    for (const anchor of anchors) {
      const scores = new Map<number, number>();
      for (const sourcePronunciation of anchor.pronunciations) {
        const pronunciation = pronunciationForDialect(sourcePronunciation, dialect);
        const signature = channelsForPronunciation(pronunciation);
        signature.vowelSuffixes.forEach((key) => {
          const length = Number(key.split(":")[1]);
          add(scores, channels, key, length === 3 ? 12 : length === 2 ? 8 : 4, preciseCap);
        });
        signature.vowelFamilySuffixes.forEach((key) => {
          const length = Number(key.split(":")[1]);
          add(scores, channels, key, length === 3 ? 9 : 6, preciseCap);
        });
        signature.consonantSuffixes.forEach((key) => {
          const length = Number(key.split(":")[1]);
          add(scores, channels, key, length === 3 ? 8 : length === 2 ? 5 : 2, preciseCap);
        });
        signature.consonantFamilySuffixes.forEach((key) => {
          const length = Number(key.split(":")[1]);
          add(scores, channels, key, length === 3 ? 12 : 10, preciseCap);
        });
        signature.stressSuffixes.forEach((key) => add(scores, channels, key, 1.25, broadCap));
        signature.vowelSketches.forEach((key) =>
          add(scores, channels, key, key.startsWith("vx:") ? 14 : 7, preciseCap));
        if (signature.coda) add(scores, channels, signature.coda, 7, preciseCap);
        signature.vowelFamilies.forEach((family) =>
          add(scores, familyChannels, family, 1.8 + 1.2 * boundedReach, broadCap));
      }
      anchorScores.push(scores);
    }

    const allCandidateIndexes = new Set<number>();
    anchorScores.forEach((scores) => scores.forEach((unused, itemIndex) => allCandidateIndexes.add(itemIndex)));
    const commonCount = Math.round(24 + 72 * boundedReach);
    commonItems.slice(0, commonCount).forEach((itemIndex) => allCandidateIndexes.add(itemIndex));

    const semanticIndexes = new Set<number>();
    semanticTerms.forEach((term) => {
      const itemIndex = byTerm.get(normalizedTerm(term));
      if (itemIndex !== undefined) {
        semanticIndexes.add(itemIndex);
        allCandidateIndexes.add(itemIndex);
      }
    });

    const maximum = Math.min(
      items.length,
      Math.round(896 + 768 * boundedReach + Math.max(0, anchors.length - 1) * 96),
    );
    const ranked = [...allCandidateIndexes]
      .map((itemIndex) => {
        const scores = anchorScores.map((values) => values.get(itemIndex) ?? 0);
        const hits = scores.filter((score) => score > 0).length;
        const mean = scores.reduce((total, score) => total + score, 0) /
          Math.max(1, scores.length);
        const weakest = Math.min(...scores);
        return {
          itemIndex,
          hits,
          mean,
          weakest,
          commonness: items[itemIndex].frequency,
        };
      })
      .sort((left, right) =>
        right.hits - left.hits ||
        right.weakest - left.weakest ||
        right.mean - left.mean ||
        right.commonness - left.commonness ||
        (items[left.itemIndex].normalized < items[right.itemIndex].normalized ? -1 : 1))
      .slice(0, maximum)
      .map((value) => value.itemIndex);

    // Semantic union candidates are never lost to the phonetic pool cap.
    semanticIndexes.forEach((itemIndex) => {
      if (!ranked.includes(itemIndex)) ranked.push(itemIndex);
    });
    // The authored/runtime phrase bank is deliberately small. Retaining it in
    // full makes mosaic discovery possible without weakening the bounded word
    // shortlist or relying on phrases to win a coarse retrieval tie.
    phraseItems.forEach((itemIndex) => {
      if (!ranked.includes(itemIndex)) ranked.push(itemIndex);
    });
    return ranked.map((itemIndex) => items[itemIndex]);
  };

  return { size: items.length, shortlist };
}
