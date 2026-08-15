import { readFile } from "node:fs/promises";

import { createRhymeEngine } from "../../lib/phonetics/engine.ts";
import { composePerformancePhraseEntries } from "../../lib/phonetic-search/performance-phrases.ts";

export const PRODUCTION_PACK_URL = new URL(
  "../../public/data/cmudict.compact.json",
  import.meta.url,
);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function utilityFromMetadata(word, senses) {
  const senseUtility = Math.min(.95, .35 + Math.log2(1 + Math.max(1, senses)) * .12);
  const lengthPenalty = Math.max(0, word.length - 13) * .012;
  return Math.max(.24, Math.min(.98, senseUtility - lengthPenalty));
}

function tagsFromMask(mask) {
  const tags = [];
  if (mask & 1) tags.push("noun");
  if (mask & 2) tags.push("verb");
  if (mask & 4) tags.push("adjective");
  if (mask & 8) tags.push("adverb");
  return tags;
}

function tagsFromMetadata(partOfSpeechMask, flags, definitions) {
  const tags = tagsFromMask(partOfSpeechMask);
  if (definitions?.spoken && (flags & definitions.spoken) !== 0) tags.push("spoken-corpus");
  if (definitions?.authored && (flags & definitions.authored) !== 0) tags.push("authored-pronunciation");
  if (definitions?.slang && (flags & definitions.slang) !== 0) tags.push("slang");
  if (definitions?.reference && (flags & definitions.reference) !== 0) tags.push("reference");
  if (definitions?.uk && (flags & definitions.uk) !== 0) tags.push("en-GB");
  return tags;
}

export async function loadProductionPack() {
  return JSON.parse(await readFile(PRODUCTION_PACK_URL, "utf8"));
}

export function productionLexiconInputs(pack) {
  const entries = pack.entries.map(
    ([text, pronunciations, partOfSpeechMask, senses, storedUtility, flags = 0]) => ({
      text,
      pronunciations,
      frequency: storedUtility === undefined
        ? utilityFromMetadata(text, senses)
        : clamp01(storedUtility / 1000),
      tags: tagsFromMetadata(partOfSpeechMask, flags, pack.entryFlags),
    }),
  );
  entries.push(
    ...pack.phrases
      .filter(([text]) => text.trim().includes(" "))
      .map(([text, pronunciations]) => ({
        text,
        pronunciations,
        kind: "phrase",
        frequency: .58,
        tags: ["phrase"],
      })),
  );
  entries.push(...composePerformancePhraseEntries(entries));
  return entries;
}

export async function createProductionEngine() {
  const pack = await loadProductionPack();
  const inputs = productionLexiconInputs(pack);
  return { pack, inputs, engine: createRhymeEngine(inputs) };
}
