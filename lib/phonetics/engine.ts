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

function rhymeStart(pronunciation: Pronunciation): number {
  let fallback = 0;
  for (let index = pronunciation.phonemes.length - 1; index >= 0; index -= 1) {
    const phone = pronunciation.phonemes[index];
    if (phone.type === "vowel") {
      if (fallback === 0) fallback = index;
      if (phone.stress === 1) return index;
    }
  }
  return fallback;
}

function scorePronunciations(left: Pronunciation, right: Pronunciation): RhymeComponents {
  const leftTail = left.phonemes.slice(rhymeStart(left));
  const rightTail = right.phonemes.slice(rhymeStart(right));
  const leftVowels = leftTail.filter((phone) => phone.type === "vowel");
  const rightVowels = rightTail.filter((phone) => phone.type === "vowel");
  const leftConsonants = leftTail.filter((phone) => phone.type === "consonant");
  const rightConsonants = rightTail.filter((phone) => phone.type === "consonant");
  const finalVowelIndexLeft = left.phonemes.findLastIndex((phone) => phone.type === "vowel");
  const finalVowelIndexRight = right.phonemes.findLastIndex((phone) => phone.type === "vowel");
  const leftCoda = left.phonemes.slice(finalVowelIndexLeft + 1);
  const rightCoda = right.phonemes.slice(finalVowelIndexRight + 1);
  const assonance = sequenceSimilarity(leftVowels, rightVowels, vowelSimilarity, .45);
  const consonance = sequenceSimilarity(leftConsonants, rightConsonants, consonantSimilarity, .38);
  const coda = sequenceSimilarity(leftCoda, rightCoda, consonantSimilarity, .45);
  const fullTail = sequenceSimilarity(leftTail, rightTail, phonemeSimilarity, .4);
  const stress = stressSimilarity(
    leftVowels.map((phone) => phone.stress ?? 0),
    rightVowels.map((phone) => phone.stress ?? 0),
  );
  // Coda is kept separate for explanation, while consonance rewards longer
  // coherent consonant patterns in multisyllabic and mosaic matches.
  const phonetic = .4 * assonance + .2 * consonance + .14 * coda + .16 * fullTail + .1 * stress;
  return {
    assonance: roundScore(assonance),
    consonance: roundScore(consonance),
    coda: roundScore(coda),
    fullTail: roundScore(fullTail),
    stress: roundScore(stress),
    phonetic: roundScore(phonetic),
  };
}

function comparisonLabels(
  left: PhoneticItem,
  right: PhoneticItem,
  components: RhymeComponents,
  leftPronunciation: Pronunciation,
  rightPronunciation: Pronunciation,
): RelationshipLabel[] {
  const labels: RelationshipLabel[] = [];
  const leftCodaLength = leftPronunciation.phonemes.length -
    leftPronunciation.phonemes.findLastIndex((phone) => phone.type === "vowel") - 1;
  const rightCodaLength = rightPronunciation.phonemes.length -
    rightPronunciation.phonemes.findLastIndex((phone) => phone.type === "vowel") - 1;
  const hasCodaEvidence = leftCodaLength > 0 && rightCodaLength > 0;
  const codaIsCompatible =
    (leftCodaLength === 0 && rightCodaLength === 0) || components.coda >= .94;
  if (components.assonance >= .64) labels.push("assonance");
  if (components.consonance >= .66 || (hasCodaEvidence && components.coda >= .78)) labels.push("consonance");
  if (components.assonance >= .94 && codaIsCompatible && components.fullTail >= .88) labels.push("full-rhyme");
  else if (components.phonetic >= .45) labels.push("slant");
  const matchedVowels = Math.min(
    leftPronunciation.phonemes.slice(rhymeStart(leftPronunciation)).filter((phone) => phone.type === "vowel").length,
    rightPronunciation.phonemes.slice(rhymeStart(rightPronunciation)).filter((phone) => phone.type === "vowel").length,
  );
  if (matchedVowels >= 2 && components.assonance >= .52) labels.push("multi-syllabic");
  if (left.kind !== right.kind && components.phonetic >= .5) labels.push("mosaic");
  return labels;
}

function phonemeNames(pronunciation: Pronunciation): string {
  return pronunciation.phonemes
    .slice(rhymeStart(pronunciation))
    .filter((phone) => phone.type === "vowel")
    .map((phone) => phone.symbol)
    .join(" → ");
}

function comparisonExplanation(
  left: Pronunciation,
  right: Pronunciation,
  components: RhymeComponents,
): string[] {
  const explanations: string[] = [];
  if (components.assonance >= .82) explanations.push(`Strong stressed-vowel relationship (${phonemeNames(left)} ↔ ${phonemeNames(right)}).`);
  else if (components.assonance >= .5) explanations.push("Related vowel shape creates loose assonance.");
  const leftHasCoda = left.phonemes.slice(left.phonemes.findLastIndex((phone) => phone.type === "vowel") + 1).length > 0;
  const rightHasCoda = right.phonemes.slice(right.phonemes.findLastIndex((phone) => phone.type === "vowel") + 1).length > 0;
  if (leftHasCoda && rightHasCoda && components.coda >= .82) explanations.push("The final consonant coda is strongly preserved.");
  else if (components.consonance >= .62) explanations.push("Consonant patterning supports the rhyme despite a looser ending.");
  if (components.stress >= .8) explanations.push("Stress and syllable emphasis align.");
  if (explanations.length === 0) explanations.push("A weak phonetic edge; useful mainly for adventurous pivots.");
  return explanations;
}

function bestComparison(
  left: PhoneticItem,
  right: PhoneticItem,
  fixedRightPronunciation?: Pronunciation,
): RhymeComparison {
  let winner: RhymeComparison | undefined;
  const rightPronunciations = fixedRightPronunciation
    ? [fixedRightPronunciation]
    : right.pronunciations;
  for (const leftPronunciation of left.pronunciations) {
    for (const rightPronunciation of rightPronunciations) {
      const components = scorePronunciations(leftPronunciation, rightPronunciation);
      const candidate: RhymeComparison = {
        left,
        right,
        leftPronunciation,
        rightPronunciation,
        components,
        labels: comparisonLabels(left, right, components, leftPronunciation, rightPronunciation),
        matchedSpan: {
          left: [rhymeStart(leftPronunciation), leftPronunciation.phonemes.length],
          right: [rhymeStart(rightPronunciation), rightPronunciation.phonemes.length],
        },
        explanation: comparisonExplanation(leftPronunciation, rightPronunciation, components),
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
    phonetic: roundScore(component("phonetic")),
    mean: roundScore(mean),
    weakest: roundScore(weakest),
    consistency: roundScore(consistency),
  };
}

function intentSoundScore(intent: RecommendationIntent, family: FamilyComponents): number {
  if (intent === "continue") return family.consistency;
  if (intent === "bridge") return .75 * family.mean + .25 * family.weakest;
  // A pivot should be recognizably connected but not another near-duplicate.
  const distanceFromUsefulPivot = Math.abs(family.mean - .58);
  return clamp01(1 - distanceFromUsefulPivot / .58);
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

export function createRhymeEngine(entries: readonly LexiconEntryInput[]): RhymeEngine {
  const explicitItems = entries.map(entryToItem);
  const itemMap = new Map(explicitItems.map((item) => [item.normalized, item]));

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
    const anchors = request.anchors.map(represent).filter((item): item is PhoneticItem => Boolean(item));
    if (anchors.length === 0) return [];
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
    const recommendations: Recommendation[] = [];

    for (const item of explicitItems) {
      if (excluded.has(item.normalized)) continue;
      // A spelling with multiple pronunciations must choose one reading for the
      // whole pinned family. Otherwise an ambiguous word such as “bow” can use
      // /boʊ/ against “flow” and /baʊ/ against “now” simultaneously.
      let pronunciation = item.pronunciations[0];
      let anchorComparisons = anchors.map((anchor) => bestComparison(anchor, item, pronunciation));
      let family = aggregateFamily(anchorComparisons);
      for (const candidatePronunciation of item.pronunciations.slice(1)) {
        const candidateComparisons = anchors.map((anchor) =>
          bestComparison(anchor, item, candidatePronunciation),
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
      const semantic = clamp01(semanticScores[item.normalized] ?? 0);
      const utility = item.frequency;
      const sound = intentSoundScore(request.intent, family);
      const score = roundScore((weights.sound * sound + weights.meaning * semantic + weights.utility * utility) / weightTotal);
      recommendations.push({
        item,
        pronunciation,
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
    return recommendations.slice(0, request.limit ?? 20);
  };

  return { items: explicitItems, represent, compare, recommend };
}
