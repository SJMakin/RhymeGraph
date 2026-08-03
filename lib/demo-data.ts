export type RelationshipKind =
  | "full-tail"
  | "assonance"
  | "consonance"
  | "slant"
  | "mosaic"
  | "semantic";

export interface CandidateView {
  id: string;
  word: string;
  pronunciation: string;
  definition: string;
  overall: number;
  sound: number;
  meaning: number;
  flow: number;
  syllables: number;
  relation: RelationshipKind;
  reasons: string[];
  estimated?: boolean;
  phrase?: boolean;
  tags?: string[];
}

export const INITIAL_DRAFT = `Late train rattles through the edge of the city
Blue light on my face, every promise looks pretty
I built this from the floor, made a future out of static
Still moving like the rent can’t argue with gravity`;

export const DEMO_CANDIDATES: CandidateView[] = [
  {
    id: "cavity",
    word: "cavity",
    pronunciation: "K AE1 V AH0 T IY0",
    definition: "an empty space inside something solid",
    overall: 95,
    sound: 98,
    meaning: 44,
    flow: 96,
    syllables: 3,
    relation: "full-tail",
    reasons: ["shared stressed /AE/", "matching 3-beat fall", "full trailing pattern"],
  },
  {
    id: "vanity",
    word: "vanity",
    pronunciation: "V AE1 N AH0 T IY0",
    definition: "excessive pride; something without lasting value",
    overall: 91,
    sound: 94,
    meaning: 58,
    flow: 95,
    syllables: 3,
    relation: "assonance",
    reasons: ["vowel chain", "same stress contour", "clean multisyllabic slant"],
  },
  {
    id: "battery",
    word: "battery",
    pronunciation: "B AE1 T ER0 IY0",
    definition: "a source of stored power; a sustained series",
    overall: 88,
    sound: 90,
    meaning: 67,
    flow: 91,
    syllables: 3,
    relation: "assonance",
    reasons: ["shared opening vowel", "falling cadence", "strong image word"],
  },
  {
    id: "tragedy",
    word: "tragedy",
    pronunciation: "T R AE1 JH AH0 D IY0",
    definition: "a disastrous event or story ending in suffering",
    overall: 86,
    sound: 88,
    meaning: 73,
    flow: 88,
    syllables: 3,
    relation: "slant",
    reasons: ["multisyllabic slant", "shared vowel sequence", "dramatic semantic turn"],
  },
  {
    id: "galaxy",
    word: "galaxy",
    pronunciation: "G AE1 L AH0 K S IY0",
    definition: "a vast system of stars; a brilliant gathering",
    overall: 84,
    sound: 85,
    meaning: 72,
    flow: 88,
    syllables: 3,
    relation: "assonance",
    reasons: ["vowel chain", "matching stress", "expansive image"],
  },
  {
    id: "rapidly",
    word: "rapidly",
    pronunciation: "R AE1 P AH0 D L IY0",
    definition: "at high speed",
    overall: 81,
    sound: 82,
    meaning: 84,
    flow: 86,
    syllables: 3,
    relation: "consonance",
    reasons: ["matching cadence", "consonant echoes", "fits motion context"],
  },
  {
    id: "salary",
    word: "salary",
    pronunciation: "S AE1 L ER0 IY0",
    definition: "regular payment received for work",
    overall: 80,
    sound: 78,
    meaning: 91,
    flow: 86,
    syllables: 3,
    relation: "semantic",
    reasons: ["shared stressed /AE/", "3 syllables", "fits rent and money context"],
  },
  {
    id: "anatomy",
    word: "anatomy",
    pronunciation: "AH0 N AE1 T AH0 M IY0",
    definition: "the structure of a body or the detailed structure of anything",
    overall: 77,
    sound: 79,
    meaning: 52,
    flow: 78,
    syllables: 4,
    relation: "slant",
    reasons: ["adventurous extension", "shared inner vowel", "longer pocket"],
  },
  {
    id: "casually",
    word: "casually",
    pronunciation: "K AE1 ZH AH0 W AH0 L IY0",
    definition: "in a relaxed or unconcerned manner",
    overall: 75,
    sound: 77,
    meaning: 63,
    flow: 76,
    syllables: 4,
    relation: "assonance",
    reasons: ["vowel sequence", "extended cadence", "delivery-friendly"],
  },
  {
    id: "have-at-me",
    word: "have at me",
    pronunciation: "HH AE1 V AE1 T M IY0",
    definition: "an invitation to confront or challenge",
    overall: 72,
    sound: 73,
    meaning: 61,
    flow: 84,
    syllables: 3,
    relation: "mosaic",
    reasons: ["cross-word mosaic", "shared stressed vowels", "punchy phrase ending"],
    phrase: true,
  },
  {
    id: "strategy",
    word: "strategy",
    pronunciation: "S T R AE1 T AH0 JH IY0",
    definition: "a plan designed to achieve a long-term aim",
    overall: 71,
    sound: 74,
    meaning: 65,
    flow: 74,
    syllables: 3,
    relation: "slant",
    reasons: ["shared stress landing", "loose final consonants", "useful concept word"],
  },
  {
    id: "magically",
    word: "magically",
    pronunciation: "M AE1 JH IH0 K L IY0",
    definition: "in a way that seems impossible or enchanted",
    overall: 68,
    sound: 70,
    meaning: 54,
    flow: 77,
    syllables: 4,
    relation: "assonance",
    reasons: ["vowel-led relation", "four-syllable run", "adventurous"],
  },
];

export const RELATION_LABEL: Record<RelationshipKind, string> = {
  "full-tail": "full tail",
  assonance: "vowel",
  consonance: "coda",
  slant: "slant",
  mosaic: "mosaic",
  semantic: "meaning bridge",
};
