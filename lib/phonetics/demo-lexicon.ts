import type { LexiconEntryInput } from "./types";

/**
 * Small, hand-audited fixture pack for the interactive prototype. Production
 * callers should inject a CMUdict-derived pack into createRhymeEngine instead.
 */
export const DEMO_LEXICON: readonly LexiconEntryInput[] = [
  { text: "time", pronunciations: ["T AY1 M"], frequency: .98 },
  { text: "mine", pronunciations: ["M AY1 N"], frequency: .93 },
  { text: "rhyme", pronunciations: ["R AY1 M"], frequency: .82 },
  { text: "divine", pronunciations: ["D IH0 V AY1 N"], frequency: .72 },
  { text: "design", pronunciations: ["D IH0 Z AY1 N"], frequency: .86 },
  { text: "behind", pronunciations: ["B IH0 HH AY1 N D"], frequency: .9 },
  { text: "light", pronunciations: ["L AY1 T"], frequency: .96 },
  { text: "life", pronunciations: ["L AY1 F"], frequency: .97 },
  { text: "love", pronunciations: ["L AH1 V"], frequency: 1 },
  { text: "move", pronunciations: ["M UW1 V"], frequency: .97 },
  { text: "dove", pronunciations: ["D AH1 V"], frequency: .7 },
  { text: "prove", pronunciations: ["P R UW1 V"], frequency: .88 },
  { text: "hand", pronunciations: ["HH AE1 N D"], frequency: .98 },
  { text: "bond", pronunciations: ["B AA1 N D"], frequency: .77 },
  { text: "land", pronunciations: ["L AE1 N D"], frequency: .94 },
  { text: "violence", pronunciations: ["V AY1 AH0 L AH0 N S"], frequency: .84 },
  { text: "silence", pronunciations: ["S AY1 L AH0 N S"], frequency: .86 },
  { text: "defiance", pronunciations: ["D IH0 F AY1 AH0 N S"], frequency: .58 },
  { text: "orange", pronunciations: ["AO1 R AH0 N JH"], frequency: .81 },
  { text: "door", pronunciations: ["D AO1 R"], frequency: .96 },
  { text: "hinge", pronunciations: ["HH IH1 N JH"], frequency: .55 },
  {
    text: "door hinge",
    pronunciations: [{ phonemes: "D AO1 R HH IH2 N JH", wordStarts: [0, 3] }],
    kind: "phrase",
    frequency: .4,
  },
  { text: "porridge", pronunciations: ["P AO1 R AH0 JH"], frequency: .43 },
  { text: "table", pronunciations: ["T EY1 B AH0 L"], frequency: .96 },
  { text: "dog", pronunciations: ["D AO1 G"], frequency: .98 },
  { text: "cat", pronunciations: ["K AE1 T"], frequency: .98 },
  { text: "music", pronunciations: ["M Y UW1 Z IH0 K"], frequency: .95 },
  { text: "quiet", pronunciations: ["K W AY1 AH0 T"], frequency: .89 },
] as const;
