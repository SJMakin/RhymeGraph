import type { PerformanceDialect, Phoneme, Pronunciation } from "./types";

const BRITISH_PRONUNCIATION_CACHE = new WeakMap<Pronunciation, Pronunciation>();

function sourceToken(phone: Phoneme): string {
  return phone.type === "vowel" ? `${phone.symbol}${phone.stress ?? 0}` : phone.symbol;
}

/**
 * A deliberately conservative performance transform. It models one broad
 * non-rhotic behaviours useful to rhyme search without pretending to be a
 * full accent synthesizer: R is dropped only after a vowel when no following
 * vowel can license linking R, and unstressed rhotic ER0 is treated as schwa.
 * Stressed ER stays distinct so the UK NURSE vowel is not collapsed into STRUT
 * (for example, bird must not become bud).
 */
export function pronunciationForDialect(
  pronunciation: Pronunciation,
  dialect: PerformanceDialect = "en-US",
): Pronunciation {
  if (dialect !== "en-GB") return pronunciation;
  const cached = BRITISH_PRONUNCIATION_CACHE.get(pronunciation);
  if (cached) return cached;

  let changed = false;
  const phonemes = pronunciation.phonemes.flatMap((phone, index) => {
    const previous = pronunciation.phonemes[index - 1];
    const next = pronunciation.phonemes[index + 1];
    if (
      phone.symbol === "R" &&
      previous?.type === "vowel" &&
      next?.type !== "vowel"
    ) {
      changed = true;
      return [];
    }
    if (phone.type === "vowel" && phone.symbol === "ER" && phone.stress === 0) {
      changed = true;
      return [{ ...phone, symbol: "AH" }];
    }
    return [phone];
  });
  const result = changed
    ? {
      source: phonemes.map(sourceToken).join(" "),
      phonemes,
      stressPattern: phonemes
        .filter((phone) => phone.type === "vowel")
        .map((phone) => phone.stress ?? 0),
      syllableCount: pronunciation.syllableCount,
    }
    : pronunciation;
  BRITISH_PRONUNCIATION_CACHE.set(pronunciation, result);
  return result;
}
