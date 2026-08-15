import type {
  FamilyComponents,
  LexiconEntryInput,
  Phoneme,
  PhoneticItem,
  Pronunciation,
  PronunciationInput,
  Recommendation,
  RecommendationIntent,
  RecommendationRequest,
  RelationshipLabel,
  RhymeComparison,
  RhymeComponents,
  RhymeEngine,
  Stress,
} from "./types";
import { pronunciationForDialect } from "./dialect";
import { createRhymeRetrievalIndex } from "./retrieval";

const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY",
  "OW", "OY", "UH", "UW",
]);

// [height, backness, rounding, diphthong movement]. This deliberately compact
// table is a retrieval/scoring approximation, not a claim about a single accent.
const VOWEL_FEATURES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  IY: [1, 0, 0, 0], IH: [.78, .12, 0, 0], EY: [.7, .08, 0, .55],
  EH: [.52, .1, 0, 0], AE: [.12, .12, 0, 0], AA: [.08, .9, 0, 0],
  AO: [.28, .88, 1, 0], OW: [.62, .9, 1, .55], UH: [.7, .72, 1, 0],
  UW: [1, .92, 1, 0], AH: [.48, .5, 0, 0], ER: [.52, .48, 0, 0],
  AY: [.2, .2, 0, 1], AW: [.22, .55, .35, 1], OY: [.3, .82, 1, 1],
};

type ConsonantFeature = readonly [place: number, manner: string, voiced: boolean];
const CONSONANT_FEATURES: Readonly<Record<string, ConsonantFeature>> = {
  P: [0, "stop", false], B: [0, "stop", true], M: [0, "nasal", true],
  F: [1, "fricative", false], V: [1, "fricative", true],
  TH: [2, "fricative", false], DH: [2, "fricative", true],
  T: [3, "stop", false], D: [3, "stop", true], N: [3, "nasal", true],
  S: [3, "fricative", false], Z: [3, "fricative", true], L: [3, "liquid", true], R: [3, "liquid", true],
  SH: [4, "fricative", false], ZH: [4, "fricative", true], CH: [4, "affricate", false], JH: [4, "affricate", true],
  Y: [5, "glide", true], K: [6, "stop", false], G: [6, "stop", true], NG: [6, "nasal", true],
  W: [7, "glide", true], HH: [8, "fricative", false],
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const roundScore = (value: number) => Math.round(clamp01(value) * 10_000) / 10_000;

export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

function parseToken(raw: string, syllable: number, wordIndex: number): Phoneme {
  const token = raw.toUpperCase().trim();
  const match = /^([A-Z]+)([012])?$/.exec(token);
  if (!match) throw new Error(`Invalid ARPAbet token: ${raw}`);
  const symbol = match[1];
  const isVowel = VOWELS.has(symbol);
  if (!isVowel && !(symbol in CONSONANT_FEATURES)) {
    throw new Error(`Unsupported ARPAbet phoneme: ${symbol}`);
  }
  const stress = isVowel ? Number(match[2] ?? 0) as Stress : null;
  return { symbol, stress, type: isVowel ? "vowel" : "consonant", syllable, wordIndex };
}

export function parsePronunciation(
  source: string | readonly string[],
  wordIndexes?: readonly number[],
): Pronunciation {
  const tokens = typeof source === "string" ? source.trim().split(/\s+/) : [...source];
  let syllable = -1;
  const phonemes = tokens.map((token, index) => {
    const symbol = token.toUpperCase().replace(/[012]$/, "");
    if (VOWELS.has(symbol)) syllable += 1;
    return parseToken(token, Math.max(0, syllable), wordIndexes?.[index] ?? 0);
  });
  const stressPattern = phonemes.filter((phone) => phone.type === "vowel").map((phone) => phone.stress ?? 0);
  if (stressPattern.length === 0) throw new Error(`Pronunciation has no vowel: ${tokens.join(" ")}`);
  return {
    source: tokens.join(" "),
    phonemes,
    stressPattern,
    syllableCount: stressPattern.length,
  };
}

function entryToItem(entry: LexiconEntryInput): PhoneticItem {
  const normalized = normalizeText(entry.text);
  return {
    text: entry.text,
    normalized,
    kind: entry.kind ?? (normalized.includes(" ") ? "phrase" : "word"),
    pronunciations: entry.pronunciations.map((pronunciation) => {
      if (typeof pronunciation === "string" || Array.isArray(pronunciation)) {
        return parsePronunciation(pronunciation as string | readonly string[]);
      }
      const input = pronunciation as PronunciationInput;
      const tokens = typeof input.phonemes === "string" ? input.phonemes.trim().split(/\s+/) : [...input.phonemes];
      const starts = input.wordStarts?.length ? input.wordStarts : [0];
      const wordIndexes = tokens.map((_, tokenIndex) => {
        let wordIndex = 0;
        for (let index = 1; index < starts.length; index += 1) {
          if (tokenIndex < starts[index]) break;
          wordIndex = index;
        }
        return wordIndex;
      });
      return parsePronunciation(tokens, wordIndexes);
    }),
    frequency: clamp01(entry.frequency ?? .5),
    tags: entry.tags ?? [],
  };
}

function vowelSimilarity(left: Phoneme, right: Phoneme): number {
  if (left.symbol === right.symbol) return 1;
  const a = VOWEL_FEATURES[left.symbol];
  const b = VOWEL_FEATURES[right.symbol];
  const distance = Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    .55 * (a[2] - b[2]) ** 2 +
    .45 * (a[3] - b[3]) ** 2,
  );
  const similarity = clamp01(Math.exp(-1.12 * distance));
  // ARPAbet ER carries strong rhotic colour that this compact height/backness
  // table cannot otherwise express. Keep ER neighbours discoverable as loose
  // assonance without treating love/serve as an almost perfect vowel match.
  if (left.symbol === "ER" || right.symbol === "ER") return Math.min(.42, similarity);
  return similarity;
}

function consonantSimilarity(left: Phoneme, right: Phoneme): number {
  if (left.symbol === right.symbol) return 1;
  const a = CONSONANT_FEATURES[left.symbol];
  const b = CONSONANT_FEATURES[right.symbol];
  let score = .04;
  if (a[1] === b[1]) score += .25;
  if (a[2] === b[2]) score += .12;
  const placeDistance = Math.abs(a[0] - b[0]);
  score += .23 * Math.max(0, 1 - placeDistance / 5);
  if (a[1] === "nasal" && b[1] === "nasal") score += .14;
  return clamp01(score);
}

function phonemeSimilarity(left: Phoneme, right: Phoneme): number {
  if (left.type !== right.type) return 0;
  return left.type === "vowel" ? vowelSimilarity(left, right) : consonantSimilarity(left, right);
}

/** Needleman-Wunsch-style suffix alignment with an explicit penalty for gaps. */
function sequenceSimilarity(
  left: readonly Phoneme[],
  right: readonly Phoneme[],
  similarity = phonemeSimilarity,
  gapPenalty = .42,
): number {
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const width = right.length + 1;
  const scores = new Array((left.length + 1) * width).fill(0) as number[];
  for (let i = 1; i <= left.length; i += 1) scores[i * width] = scores[(i - 1) * width] - gapPenalty;
  for (let j = 1; j <= right.length; j += 1) scores[j] = scores[j - 1] - gapPenalty;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const diagonal = scores[(i - 1) * width + j - 1] + similarity(left[i - 1], right[j - 1]);
      const remove = scores[(i - 1) * width + j] - gapPenalty;
      const insert = scores[i * width + j - 1] - gapPenalty;
      scores[i * width + j] = Math.max(diagonal, remove, insert);
    }
  }
  return clamp01(scores[left.length * width + right.length] / ((left.length + right.length) / 2));
}

function stressSimilarity(left: readonly Stress[], right: readonly Stress[]): number {
  const pseudoPhone = (stress: Stress): Phoneme => ({
    symbol: "AH", stress, type: "vowel", syllable: 0, wordIndex: 0,
  });
  return sequenceSimilarity(
    left.map(pseudoPhone),
    right.map(pseudoPhone),
    (a, b) => a.stress === b.stress ? 1 : a.stress === 0 || b.stress === 0 ? .25 : .62,
    .5,
  );
}

interface RhymeWindow {
  start: number;
  end: number;
  phonemes: readonly Phoneme[];
  vowels: readonly Phoneme[];
  syllables: number;
  coverage: number;
}

interface ScoredPronunciations {
  components: RhymeComponents;
  depth: number;
  matchedSpan: {
    left: readonly [number, number];
    right: readonly [number, number];
  };
}

const MAX_RHYME_WINDOW_SYLLABLES = 6;
const RHYME_WINDOW_CACHE = new WeakMap<Pronunciation, RhymeWindow[]>();

function syllableWeight(stress: Stress | null): number {
  if (stress === 1) return 1;
  if (stress === 2) return .72;
  return .28;
}

function suffixWindows(pronunciation: Pronunciation): RhymeWindow[] {
  const cached = RHYME_WINDOW_CACHE.get(pronunciation);
  if (cached) return cached;
  const vowelIndexes = pronunciation.phonemes.flatMap((phone, index) =>
    phone.type === "vowel" ? [index] : []);
  const available = vowelIndexes.slice(-MAX_RHYME_WINDOW_SYLLABLES);
  const totalWeight = available.reduce(
    (total, index) => total + syllableWeight(pronunciation.phonemes[index].stress),
    0,
  );
  const windows = available.map((start, index) => {
    const vowels = pronunciation.phonemes
      .slice(start)
      .filter((phone) => phone.type === "vowel");
    const coveredWeight = vowels.reduce(
      (total, phone) => total + syllableWeight(phone.stress),
      0,
    );
    return {
      start,
      end: pronunciation.phonemes.length,
      phonemes: pronunciation.phonemes.slice(start),
      vowels,
      syllables: available.length - index,
      coverage: coveredWeight / Math.max(totalWeight, Number.EPSILON),
    };
  });
  RHYME_WINDOW_CACHE.set(pronunciation, windows);
  return windows;
}

function scoreWindows(
  left: RhymeWindow,
  right: RhymeWindow,
  phraseInvolved: boolean,
): RhymeComponents {
  const leftTail = left.phonemes;
  const rightTail = right.phonemes;
  const leftVowels = leftTail.filter((phone) => phone.type === "vowel");
  const rightVowels = rightTail.filter((phone) => phone.type === "vowel");
  const leftConsonants = leftTail.filter((phone) => phone.type === "consonant");
  const rightConsonants = rightTail.filter((phone) => phone.type === "consonant");
  const finalVowelIndexLeft = left.phonemes.findLastIndex((phone) => phone.type === "vowel");
  const finalVowelIndexRight = right.phonemes.findLastIndex((phone) => phone.type === "vowel");
  const leftCoda = left.phonemes.slice(finalVowelIndexLeft + 1);
  const rightCoda = right.phonemes.slice(finalVowelIndexRight + 1);
  const assonance = sequenceSimilarity(leftVowels, rightVowels, vowelSimilarity, .45);
  const hasConsonanceEvidence = leftConsonants.length > 0 || rightConsonants.length > 0;
  const hasCodaEvidence = leftCoda.length > 0 || rightCoda.length > 0;
  const consonance = hasConsonanceEvidence
    ? sequenceSimilarity(leftConsonants, rightConsonants, consonantSimilarity, .38)
    : 0;
  const coda = hasCodaEvidence
    ? sequenceSimilarity(leftCoda, rightCoda, consonantSimilarity, .45)
    : 0;
  const fullTail = sequenceSimilarity(leftTail, rightTail, phonemeSimilarity, .4);
  const stress = stressSimilarity(
    leftVowels.map((phone) => phone.stress ?? 0),
    rightVowels.map((phone) => phone.stress ?? 0),
  );
  // Coda is kept separate for explanation, while consonance rewards longer
  // coherent consonant patterns in multisyllabic and mosaic matches. When both
  // sides have no consonants, omit those signals instead of awarding perfect
  // empty-sequence matches and renormalize the evidence that is present.
  const consonanceWeight = hasConsonanceEvidence ? .2 : 0;
  const codaWeight = hasCodaEvidence ? .14 : 0;
  const weightTotal = .4 + consonanceWeight + codaWeight + .16 + .1;
  const basePhonetic = (
    .4 * assonance +
    consonanceWeight * consonance +
    codaWeight * coda +
    .16 * fullTail +
    .1 * stress
  ) / weightTotal;
  const coverage = 2 * left.coverage * right.coverage /
    Math.max(Number.EPSILON, left.coverage + right.coverage);
  const balance = Math.min(left.syllables, right.syllables) /
    Math.max(left.syllables, right.syllables);
  // A short exact suffix remains useful, but it no longer masquerades as a
  // complete phrase rhyme when one side contains another salient beat. Longer
  // vowel chains earn an explicit, bounded reward.
  // Phrase comparisons demand broader evidence: an exact final word is not by
  // itself a better mosaic than a coherent chain spanning both phrases.
  const coverageFactor = phraseInvolved
    ? .25 + .75 * coverage
    : .58 + .42 * coverage;
  const balanceFactor = .86 + .14 * balance;
  // Segment identity is not enough for a musical full match: inverted stress
  // should stay useful, but it must not saturate the score merely because a
  // longer vowel chain earned a depth reward.
  const stressFactor = .9 + .1 * stress;
  const depthReward = .09 * Math.max(0, Math.min(left.syllables, right.syllables) - 1) *
    coverage * assonance * stress;
  const weightedBase = basePhonetic * coverageFactor * balanceFactor * stressFactor;
  // Reward depth only inside the remaining headroom. An imperfect two- or
  // three-beat relationship must never become a synthetic 1.0 by addition.
  const phonetic = clamp01(weightedBase + depthReward * (1 - weightedBase));
  return {
    assonance: roundScore(assonance),
    consonance: roundScore(consonance),
    coda: roundScore(coda),
    fullTail: roundScore(fullTail),
    stress: roundScore(stress),
    coverage: roundScore(coverage),
    balance: roundScore(balance),
    phonetic: roundScore(phonetic),
  };
}

function scorePronunciations(
  left: Pronunciation,
  right: Pronunciation,
  phraseInvolved: boolean,
): ScoredPronunciations {
  let winner: ScoredPronunciations | undefined;
  for (const leftWindow of suffixWindows(left)) {
    for (const rightWindow of suffixWindows(right)) {
      // Dropped syllables are useful; radically unbalanced windows are usually
      // accidental vowel matches and create needless work.
      if (Math.abs(leftWindow.syllables - rightWindow.syllables) > 1) continue;
      const components = scoreWindows(leftWindow, rightWindow, phraseInvolved);
      const candidate: ScoredPronunciations = {
        components,
        depth: Math.min(leftWindow.syllables, rightWindow.syllables),
        matchedSpan: {
          left: [leftWindow.start, leftWindow.end],
          right: [rightWindow.start, rightWindow.end],
        },
      };
      if (
        !winner ||
        components.phonetic > winner.components.phonetic ||
        (components.phonetic === winner.components.phonetic &&
          components.coverage > winner.components.coverage) ||
        (components.phonetic === winner.components.phonetic &&
          components.coverage === winner.components.coverage &&
          candidate.depth > winner.depth)
      ) winner = candidate;
    }
  }
  return winner!;
}

function comparisonLabels(
  left: PhoneticItem,
  right: PhoneticItem,
  components: RhymeComponents,
  leftPronunciation: Pronunciation,
  rightPronunciation: Pronunciation,
  matchedSpan: ScoredPronunciations["matchedSpan"],
): RelationshipLabel[] {
  const labels: RelationshipLabel[] = [];
  const leftCodaLength = leftPronunciation.phonemes.length -
    leftPronunciation.phonemes.findLastIndex((phone) => phone.type === "vowel") - 1;
  const rightCodaLength = rightPronunciation.phonemes.length -
    rightPronunciation.phonemes.findLastIndex((phone) => phone.type === "vowel") - 1;
  const hasCodaEvidence = leftCodaLength > 0 && rightCodaLength > 0;
  const codaIsCompatible =
    (leftCodaLength === 0 && rightCodaLength === 0) || components.coda >= .94;
  const suffixCoverageIsCompatible =
    (left.kind === "word" && right.kind === "word") || components.coverage >= .86;
  if (components.assonance >= .64) labels.push("assonance");
  if (components.consonance >= .66 || (hasCodaEvidence && components.coda >= .78)) labels.push("consonance");
  if (
    components.assonance >= .94 &&
    codaIsCompatible &&
    components.fullTail >= .94 &&
    components.stress >= .7 &&
    suffixCoverageIsCompatible &&
    components.balance >= .8
  ) labels.push("full-rhyme");
  else if (components.phonetic >= .45) labels.push("slant");
  const matchedVowels = Math.min(
    leftPronunciation.phonemes.slice(...matchedSpan.left).filter((phone) => phone.type === "vowel").length,
    rightPronunciation.phonemes.slice(...matchedSpan.right).filter((phone) => phone.type === "vowel").length,
  );
  if (matchedVowels >= 2 && components.assonance >= .52) labels.push("multi-syllabic");
  const crossesWords = (pronunciation: Pronunciation, span: readonly [number, number]) =>
    new Set(pronunciation.phonemes.slice(...span).map((phone) => phone.wordIndex)).size > 1;
  if (
    components.phonetic >= .5 &&
    (crossesWords(leftPronunciation, matchedSpan.left) ||
      crossesWords(rightPronunciation, matchedSpan.right))
  ) labels.push("mosaic");
  return labels;
}

function phonemeNames(pronunciation: Pronunciation, span: readonly [number, number]): string {
  return pronunciation.phonemes
    .slice(...span)
    .filter((phone) => phone.type === "vowel")
    .map((phone) => phone.symbol)
    .join(" → ");
}

function comparisonExplanation(
  left: Pronunciation,
  right: Pronunciation,
  components: RhymeComponents,
  matchedSpan: ScoredPronunciations["matchedSpan"],
): string[] {
  const explanations: string[] = [];
  if (components.assonance >= .82 && components.stress >= .7) explanations.push(`Strong stressed-vowel relationship (${phonemeNames(left, matchedSpan.left)} ↔ ${phonemeNames(right, matchedSpan.right)}).`);
  else if (components.assonance >= .82) explanations.push(`The vowel sequence matches, but the emphasis falls differently (${phonemeNames(left, matchedSpan.left)} ↔ ${phonemeNames(right, matchedSpan.right)}).`);
  else if (components.assonance >= .5) explanations.push("Related vowel shape creates loose assonance.");
  const leftHasCoda = left.phonemes.slice(left.phonemes.findLastIndex((phone) => phone.type === "vowel") + 1).length > 0;
  const rightHasCoda = right.phonemes.slice(right.phonemes.findLastIndex((phone) => phone.type === "vowel") + 1).length > 0;
  if (leftHasCoda && rightHasCoda && components.coda >= .82) explanations.push("The final consonant coda is strongly preserved.");
  else if (components.consonance >= .62) explanations.push("Consonant patterning supports the rhyme despite a looser ending.");
  if (components.stress >= .8) explanations.push("Stress and syllable emphasis align.");
  if (components.coverage >= .9 && Math.min(
    left.phonemes.slice(...matchedSpan.left).filter((phone) => phone.type === "vowel").length,
    right.phonemes.slice(...matchedSpan.right).filter((phone) => phone.type === "vowel").length,
  ) >= 3) explanations.push("The relationship carries across an extended syllable window.");
  if (explanations.length === 0) explanations.push("A weak phonetic edge; useful mainly for adventurous pivots.");
  return explanations;
}

function bestComparison(
  left: PhoneticItem,
  right: PhoneticItem,
  fixedRightPronunciation?: Pronunciation,
  dialect: "en-US" | "en-GB" = "en-US",
): RhymeComparison {
  let winner: RhymeComparison | undefined;
  const rightPronunciations = fixedRightPronunciation
    ? [fixedRightPronunciation]
    : right.pronunciations;
  for (const sourceLeftPronunciation of left.pronunciations) {
    for (const sourceRightPronunciation of rightPronunciations) {
      const leftPronunciation = pronunciationForDialect(sourceLeftPronunciation, dialect);
      const rightPronunciation = pronunciationForDialect(sourceRightPronunciation, dialect);
      const components = scorePronunciations(
        leftPronunciation,
        rightPronunciation,
        left.kind === "phrase" || right.kind === "phrase",
      );
      const candidate: RhymeComparison = {
        left,
        right,
        leftPronunciation,
        rightPronunciation,
        components: components.components,
        labels: comparisonLabels(left, right, components.components, leftPronunciation, rightPronunciation, components.matchedSpan),
        matchedSpan: components.matchedSpan,
        explanation: comparisonExplanation(leftPronunciation, rightPronunciation, components.components, components.matchedSpan),
      };
      if (!winner || candidate.components.phonetic > winner.components.phonetic) winner = candidate;
    }
  }
  return winner!;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function aggregateFamily(comparisons: readonly RhymeComparison[]): FamilyComponents {
  const component = (key: keyof RhymeComponents) => average(comparisons.map((item) => item.components[key]));
  const scores = comparisons.map((item) => item.components.phonetic);
  const mean = average(scores);
  const weakest = Math.min(...scores);
  // Mean rewards broad fit; weakest prevents a candidate close to only one pin
  // from masquerading as a continuation of the whole family.
  const consistency = .68 * mean + .32 * weakest;
  return {
    assonance: roundScore(component("assonance")),
    consonance: roundScore(component("consonance")),
    coda: roundScore(component("coda")),
    fullTail: roundScore(component("fullTail")),
    stress: roundScore(component("stress")),
    coverage: roundScore(component("coverage")),
    balance: roundScore(component("balance")),
    phonetic: roundScore(component("phonetic")),
    mean: roundScore(mean),
    weakest: roundScore(weakest),
    consistency: roundScore(consistency),
  };
}

function intentSoundScore(intent: RecommendationIntent, family: FamilyComponents, reach: number): number {
  const target = 1 - .46 * reach;
  const targetAffinity = clamp01(1 - Math.abs(family.mean - target) / (.3 + .18 * reach));
  if (intent === "continue") {
    const fidelity = .62 * family.consistency + .18 * family.fullTail +
      .12 * family.stress + .08 * family.coverage;
    const exploration = .46 * targetAffinity + .3 * family.assonance +
      .14 * family.balance + .1 * family.consonance;
    return (1 - .72 * reach) * fidelity + .72 * reach * exploration;
  }
  if (intent === "bridge") {
    const fidelity = .75 * family.mean + .25 * family.weakest;
    const exploration = .5 * targetAffinity + .3 * family.assonance + .2 * family.balance;
    return (1 - .6 * reach) * fidelity + .6 * reach * exploration;
  }
  // Pivot always seeks a recognisable neighbouring family, even at minimum
  // Reach. Reach then moves that target farther away; vowel/consonant evidence
  // prevents a merely remote word from winning because it hit the score band.
  const pivotTarget = .62 - .18 * reach;
  const pivotAffinity = clamp01(
    1 - Math.abs(family.mean - pivotTarget) / (.3 + .18 * reach),
  );
  const connection = .55 + .45 * Math.max(family.assonance, family.consonance);
  return pivotAffinity * connection;
}

function collectLabels(comparisons: readonly RhymeComparison[], intent: RecommendationIntent, semantic: number): RelationshipLabel[] {
  const labels = new Set<RelationshipLabel>();
  const familyWideLabels = new Set<RelationshipLabel>(["full-rhyme", "multi-syllabic"]);
  for (const comparison of comparisons) {
    for (const label of comparison.labels) {
      if (!familyWideLabels.has(label)) labels.add(label);
    }
  }
  for (const label of familyWideLabels) {
    if (comparisons.every((comparison) => comparison.labels.includes(label))) labels.add(label);
  }
  if (intent === "bridge" && semantic >= .55) labels.add("semantic-bridge");
  if (intent === "pivot") labels.add("sound-pivot");
  return [...labels];
}

function familyExplanation(
  intent: RecommendationIntent,
  anchors: readonly PhoneticItem[],
  family: FamilyComponents,
  semantic: number,
): string[] {
  const explanation: string[] = [];
  if (anchors.length > 1) {
    explanation.push(`Fits all ${anchors.length} anchors with ${Math.round(family.consistency * 100)}% family consistency.`);
  }
  if (family.assonance >= .72) explanation.push("The shared vowel family is the strongest signal.");
  if (family.coda >= .72) explanation.push("The ending consonants reinforce the family.");
  if (intent === "bridge" && semantic > 0) explanation.push(`Semantic context contributes ${Math.round(semantic * 100)}%.`);
  if (intent === "pivot") explanation.push("Chosen as a neighbouring sound family rather than a duplicate rhyme.");
  return explanation;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writingUtility(item: PhoneticItem): number {
  // CMU/SUBTLEX legitimately contain spoken abbreviations such as MR/DR/SR,
  // but bare consonant spellings are rarely useful as surfaced lyric words.
  // Keep them searchable while preventing corpus frequency from making them
  // dominate a neighbourhood intended for writing.
  const opaqueAbbreviation = item.kind === "word" &&
    /^[a-z]{2,4}$/.test(item.normalized) &&
    !/[aeiouy]/.test(item.normalized);
  return opaqueAbbreviation ? item.frequency * .25 : item.frequency;
}

const ULTRA_SHORT_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "for",
  "from", "had", "has", "he", "her", "him", "his", "i", "if", "in", "is",
  "it", "me", "my", "no", "not", "of", "on", "or", "our", "she", "so",
  "than", "that", "the", "their", "them", "then", "they", "this", "to", "up",
  "us", "was", "we", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "you", "your",
]);

function recommendationFamilySignature(recommendation: Recommendation): string {
  const signatures = recommendation.anchorComparisons.map((comparison) => {
    const phones = comparison.rightPronunciation.phonemes
      .slice(...comparison.matchedSpan.right);
    const vowels = phones
      .filter((phone) => phone.type === "vowel")
      .map((phone) => phone.symbol);
    const finalVowel = phones.findLastIndex((phone) => phone.type === "vowel");
    const coda = phones.slice(finalVowel + 1)
      .filter((phone) => phone.type === "consonant")
      .map((phone) => phone.symbol);
    return `${vowels.join("-")}|${coda.join("-")}`;
  });
  return [...new Set(signatures)].sort(lexicalCompare).join("&");
}

function diversifyRecommendations(
  recommendations: readonly Recommendation[],
  reach: number,
  limit: number,
): readonly Recommendation[] {
  if (reach === 0 || limit <= 0) return recommendations.slice(0, limit);
  const output: Recommendation[] = [];
  const selected = new Set<Recommendation>();
  const familyCounts = new Map<string, number>();
  const signatures = new Map(
    recommendations.map((item) => [item, recommendationFamilySignature(item)]),
  );
  const diverseHead = Math.min(40, limit);
  const familyQuota = Math.max(2, Math.round(5 - 3 * reach));
  const functionQuota = Math.max(2, Math.round(5 - 3 * reach));
  const phraseQuota = reach < .18 ? 0 : Math.min(4, Math.max(1, Math.round(4 * reach)));
  const phraseSlots = [9, 19, 29, 39].slice(0, phraseQuota)
    .filter((slot) => slot < diverseHead);
  const phraseCandidates = recommendations.filter((item) => item.item.kind === "phrase");
  let functionWords = 0;

  const select = (candidate: Recommendation) => {
    selected.add(candidate);
    output.push(candidate);
    const signature = signatures.get(candidate)!;
    familyCounts.set(signature, (familyCounts.get(signature) ?? 0) + 1);
    if (ULTRA_SHORT_FUNCTION_WORDS.has(candidate.item.normalized)) functionWords += 1;
  };

  for (let slot = 0; slot < Math.min(limit, recommendations.length); slot += 1) {
    if (phraseSlots.includes(slot)) {
      const phrase = phraseCandidates.find((candidate) => !selected.has(candidate));
      if (phrase) {
        select(phrase);
        continue;
      }
    }
    const candidate = recommendations.find((item) => {
      if (selected.has(item)) return false;
      if (slot >= diverseHead) return true;
      const familyCount = familyCounts.get(signatures.get(item)!) ?? 0;
      if (familyCount >= familyQuota) return false;
      if (
        slot < 20 &&
        ULTRA_SHORT_FUNCTION_WORDS.has(item.item.normalized) &&
        functionWords >= functionQuota
      ) return false;
      return true;
    }) ?? recommendations.find((item) => !selected.has(item));
    if (!candidate) break;
    select(candidate);
  }
  return output;
}

export function createRhymeEngine(entries: readonly LexiconEntryInput[]): RhymeEngine {
  const explicitItems = entries.map(entryToItem);
  const itemMap = new Map(explicitItems.map((item) => [item.normalized, item]));
  const retrievalIndex = createRhymeRetrievalIndex(explicitItems);

  const represent = (text: string): PhoneticItem | undefined => {
    const normalized = normalizeText(text);
    const explicit = itemMap.get(normalized);
    if (explicit) return explicit;
    const words = normalized.split(" ");
    if (words.length < 2) return undefined;
    const wordItems = words.map((word) => itemMap.get(word));
    if (wordItems.some((item) => !item)) return undefined;
    const tokens: string[] = [];
    const wordIndexes: number[] = [];
    for (let wordIndex = 0; wordIndex < wordItems.length; wordIndex += 1) {
      const pronunciation = wordItems[wordIndex]!.pronunciations[0];
      tokens.push(...pronunciation.source.split(" "));
      wordIndexes.push(...pronunciation.phonemes.map(() => wordIndex));
    }
    return {
      text: normalized,
      normalized,
      kind: "phrase",
      pronunciations: [parsePronunciation(tokens, wordIndexes)],
      frequency: average(wordItems.map((item) => item!.frequency)) * .8,
      tags: ["composed-phrase"],
    };
  };

  const compare = (leftText: string, rightText: string): RhymeComparison | undefined => {
    const left = represent(leftText);
    const right = represent(rightText);
    return left && right ? bestComparison(left, right) : undefined;
  };

  const recommend = (request: RecommendationRequest): readonly Recommendation[] => {
    const representedAnchors = request.anchors.map(represent);
    if (
      representedAnchors.length === 0 ||
      representedAnchors.some((item) => !item)
    ) return [];
    const anchors = representedAnchors as PhoneticItem[];
    const excluded = new Set([
      ...anchors.map((item) => item.normalized),
      ...(request.exclude ?? []).map(normalizeText),
    ]);
    const weights = {
      sound: request.weights?.sound ?? (request.intent === "bridge" ? .56 : .82),
      meaning: request.weights?.meaning ?? (request.intent === "bridge" ? .36 : .1),
      utility: request.weights?.utility ?? .08,
    };
    const weightTotal = weights.sound + weights.meaning + weights.utility || 1;
    const semanticScores = request.semanticScores ?? {};
    const minPhonetic = request.minPhonetic ?? (request.intent === "pivot" ? .32 : .45);
    const reach = clamp01(request.reach ?? 0);
    const dialect = request.dialect ?? "en-US";
    const recommendations: Recommendation[] = [];
    const searchableItems = request.candidatePool === "exhaustive"
      ? explicitItems
      : retrievalIndex.shortlist({
        anchors,
        reach,
        dialect,
        semanticTerms: Object.keys(semanticScores),
      });

    for (const item of searchableItems) {
      if (excluded.has(item.normalized)) continue;
      // A spelling with multiple pronunciations must choose one reading for the
      // whole pinned family. Otherwise an ambiguous word such as “bow” can use
      // /boʊ/ against “flow” and /baʊ/ against “now” simultaneously.
      let pronunciation = item.pronunciations[0];
      let anchorComparisons = anchors.map((anchor) =>
        bestComparison(anchor, item, pronunciation, dialect));
      let family = aggregateFamily(anchorComparisons);
      for (const candidatePronunciation of item.pronunciations.slice(1)) {
        const candidateComparisons = anchors.map((anchor) =>
          bestComparison(anchor, item, candidatePronunciation, dialect),
        );
        const candidateFamily = aggregateFamily(candidateComparisons);
        if (
          candidateFamily.consistency > family.consistency ||
          (candidateFamily.consistency === family.consistency && candidateFamily.mean > family.mean)
        ) {
          pronunciation = candidatePronunciation;
          anchorComparisons = candidateComparisons;
          family = candidateFamily;
        }
      }
      if (family.mean < minPhonetic) continue;
      const rawSemantic = Object.prototype.hasOwnProperty.call(
        semanticScores,
        item.normalized,
      )
        ? semanticScores[item.normalized]
        : 0;
      const semantic =
        typeof rawSemantic === "number" && Number.isFinite(rawSemantic)
          ? clamp01(rawSemantic)
          : 0;
      const utility = writingUtility(item);
      const sound = intentSoundScore(request.intent, family, reach);
      const score = roundScore((weights.sound * sound + weights.meaning * semantic + weights.utility * utility) / weightTotal);
      recommendations.push({
        item,
        pronunciation: pronunciationForDialect(pronunciation, dialect),
        intent: request.intent,
        score,
        family,
        semantic: roundScore(semantic),
        utility: roundScore(utility),
        labels: collectLabels(anchorComparisons, request.intent, semantic),
        explanation: familyExplanation(request.intent, anchors, family, semantic),
        anchorComparisons,
      });
    }
    recommendations.sort((left, right) => right.score - left.score || lexicalCompare(left.item.normalized, right.item.normalized));
    return diversifyRecommendations(recommendations, reach, request.limit ?? 20);
  };

  return { items: explicitItems, represent, compare, recommend };
}
