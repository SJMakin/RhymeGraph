export type Stress = 0 | 1 | 2;

export type RecommendationIntent = "continue" | "bridge" | "pivot";

export type PerformanceDialect = "en-US" | "en-GB";

export type RelationshipLabel =
  | "full-rhyme"
  | "assonance"
  | "consonance"
  | "slant"
  | "multi-syllabic"
  | "mosaic"
  | "semantic-bridge"
  | "sound-pivot";

export interface LexiconEntryInput {
  text: string;
  /** ARPAbet, including CMU-style stress digits on vowels. */
  pronunciations: readonly (string | readonly string[] | PronunciationInput)[];
  kind?: "word" | "phrase";
  frequency?: number;
  tags?: readonly string[];
}

export interface PronunciationInput {
  phonemes: string | readonly string[];
  /** Zero-based phoneme indexes at which each written word begins. */
  wordStarts?: readonly number[];
}

export interface Phoneme {
  symbol: string;
  stress: Stress | null;
  type: "vowel" | "consonant";
  syllable: number;
  wordIndex: number;
}

export interface Pronunciation {
  source: string;
  phonemes: readonly Phoneme[];
  stressPattern: readonly Stress[];
  syllableCount: number;
}

export interface PhoneticItem {
  text: string;
  normalized: string;
  kind: "word" | "phrase";
  pronunciations: readonly Pronunciation[];
  frequency: number;
  tags: readonly string[];
}

export interface RhymeComponents {
  /** Aligned vowel nuclei, with extra weight on stressed nuclei. */
  assonance: number;
  /** Consonant similarity within the compared rhyme tails. */
  consonance: number;
  /** Similarity of the final coda after the last vowel. */
  coda: number;
  /** Whole selected suffix-window alignment. */
  fullTail: number;
  /** Syllable stress-sequence compatibility. */
  stress: number;
  /** Salient suffix material covered by the selected window pair. */
  coverage: number;
  /** Compatibility of the selected window syllable counts. */
  balance: number;
  /** Late-fused phonetic score. */
  phonetic: number;
}

export interface RhymeComparison {
  left: PhoneticItem;
  right: PhoneticItem;
  leftPronunciation: Pronunciation;
  rightPronunciation: Pronunciation;
  components: RhymeComponents;
  labels: readonly RelationshipLabel[];
  matchedSpan: {
    left: readonly [number, number];
    right: readonly [number, number];
  };
  explanation: readonly string[];
}

export interface RecommendationRequest {
  anchors: readonly string[];
  intent: RecommendationIntent;
  /**
   * Normalized 0..1 semantic similarities, normally supplied by the browser
   * embedding worker. Keys are normalized candidate text.
   */
  semanticScores?: Readonly<Record<string, number>>;
  limit?: number;
  exclude?: readonly string[];
  minPhonetic?: number;
  /** 0 = tight continuations; 1 = deliberately looser neighbouring families. */
  reach?: number;
  /** Conservative performance-pronunciation transform used during scoring. */
  dialect?: PerformanceDialect;
  /** Diagnostic escape hatch for retrieval-recall evaluation. */
  candidatePool?: "indexed" | "exhaustive";
  weights?: Partial<{
    sound: number;
    meaning: number;
    utility: number;
  }>;
}

export interface FamilyComponents extends RhymeComponents {
  mean: number;
  weakest: number;
  consistency: number;
}

export interface Recommendation {
  item: PhoneticItem;
  /** The single candidate pronunciation used across every anchor comparison. */
  pronunciation: Pronunciation;
  intent: RecommendationIntent;
  score: number;
  family: FamilyComponents;
  semantic: number;
  utility: number;
  labels: readonly RelationshipLabel[];
  explanation: readonly string[];
  anchorComparisons: readonly RhymeComparison[];
}

export interface RhymeEngine {
  readonly items: readonly PhoneticItem[];
  represent(text: string): PhoneticItem | undefined;
  compare(left: string, right: string): RhymeComparison | undefined;
  recommend(request: RecommendationRequest): readonly Recommendation[];
}
