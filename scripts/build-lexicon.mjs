import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dictionary } from "cmu-pronouncing-dictionary";

const require = createRequire(import.meta.url);
const wordnet = require("wordnet-db");

const outputDirectory = new URL("../public/data/", import.meta.url);
const outputFile = new URL("cmudict.compact.json", outputDirectory);

const partOfSpeechBit = { noun: 1, verb: 2, adj: 4, adv: 8 };
const wordnetMetadata = new Map();

for (const partOfSpeech of Object.keys(partOfSpeechBit)) {
  const contents = await readFile(join(wordnet.path, `index.${partOfSpeech}`), "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const fields = line.split(/\s+/);
    const word = fields[0].replaceAll("_", " ").toLowerCase();
    const synsetCount = Number(fields[2]) || 1;
    const current = wordnetMetadata.get(word) ?? { pos: 0, senses: 0 };
    current.pos |= partOfSpeechBit[partOfSpeech];
    current.senses += synsetCount;
    wordnetMetadata.set(word, current);
  }
}

const curatedExtras = new Set([
  "af", "ain't", "bars", "bout", "bruh", "bussin", "cadence", "can't",
  "cap", "cavity", "cuz", "deadass", "dope", "drip", "em", "fam", "finna",
  "flex", "flow", "freestyle", "gimme", "glizzy", "gonna", "gotta", "gravity",
  "hella", "highkey", "homie", "ima", "imma", "innit", "kinda", "lemme",
  "lil", "lit", "lotta", "lowkey", "lyric", "lyrics", "mandem", "mic",
  "neva", "opp", "opps", "outta", "peng", "rap", "rapper", "rapping",
  "rhyme", "rhymes", "rhyming", "rizz", "roadman", "shawty", "shorty",
  "slang", "spit", "ting", "tryna", "verse", "verses", "vibe", "vibing",
  "wack", "wagwan", "wanna", "y'all", "yeet",
]);

// Small, authored overrides cover high-value spoken/slang anchors that formal
// dictionaries routinely omit. They are intentionally transparent and easy to
// replace with dialect packs later.
const curatedPronunciations = {
  af: ["EY1 EH1 F"], bout: ["B AW1 T"], bruh: ["B R AH1"],
  bussin: ["B AH1 S IH0 N"], "can't": ["K AE1 N T"], cap: ["K AE1 P"],
  cuz: ["K AH1 Z"], deadass: ["D EH1 D AE2 S"], drip: ["D R IH1 P"],
  em: ["AH0 M"], fam: ["F AE1 M"], finna: ["F IH1 N AH0"],
  flex: ["F L EH1 K S"], gimme: ["G IH1 M IY0"], glizzy: ["G L IH1 Z IY0"],
  gonna: ["G AH1 N AH0"], gotta: ["G AA1 T AH0"], hella: ["HH EH1 L AH0"],
  highkey: ["HH AY1 K IY2"], homie: ["HH OW1 M IY0"], ima: ["AY1 M AH0"],
  imma: ["AY1 M AH0"], innit: ["IH1 N IH0 T"], kinda: ["K AY1 N D AH0"],
  lemme: ["L EH1 M IY0"], lil: ["L IH1 L"], lotta: ["L AA1 T AH0"],
  lowkey: ["L OW1 K IY2"], mandem: ["M AE1 N D EH2 M"], neva: ["N EH1 V AH0"],
  opp: ["AA1 P"], opps: ["AA1 P S"], outta: ["AW1 T AH0"],
  peng: ["P EH1 NG"], rizz: ["R IH1 Z"], roadman: ["R OW1 D M AE2 N"],
  shawty: ["SH AO1 T IY0"], shorty: ["SH AO1 R T IY0"], ting: ["T IH1 NG"],
  tryna: ["T R AY1 N AH0"], vibing: ["V AY1 B IH0 NG"],
  wack: ["W AE1 K"], wagwan: ["W AA1 G W AA2 N"], wanna: ["W AA1 N AH0"],
  "y'all": ["Y AO1 L"], yeet: ["Y IY1 T"],
};

const grouped = new Map();
const supportedPhonemes = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "B", "CH", "D", "DH", "EH",
  "ER", "EY", "F", "G", "HH", "IH", "IY", "JH", "K", "L", "M", "N",
  "NG", "OW", "OY", "P", "R", "S", "SH", "T", "TH", "UH", "UW", "V",
  "W", "Y", "Z", "ZH",
]);
const vowelPhonemes = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY",
  "OW", "OY", "UH", "UW",
]);

for (const [rawKey, pronunciation] of Object.entries(dictionary)) {
  const word = rawKey.replace(/\(\d+\)$/, "").toLowerCase();

  // CMUdict contains acronyms, possessives, proper names, and corpus artefacts.
  // Keep normal lyric-friendly spellings here and leave richer normalization to
  // the runtime. This produces a broad intermediate vocabulary; the WordNet and
  // curated filter below determines the smaller pack that is actually shipped.
  if (!/^[a-z]+(?:['-][a-z]+)*$/.test(word) || word.length > 28) continue;

  const pronunciationTokens = pronunciation.split(/\s+/);
  const pronunciationIsSupported = pronunciationTokens.every((token) => {
    const match = /^([A-Z]+)(?:[012])?$/.exec(token);
    return Boolean(match && supportedPhonemes.has(match[1]));
  });
  const hasVowel = pronunciationTokens.some((token) =>
    vowelPhonemes.has(token.replace(/[012]$/, "")),
  );
  if (!pronunciationIsSupported || !hasVowel) continue;

  const variants = grouped.get(word) ?? [];
  if (!variants.includes(pronunciation)) variants.push(pronunciation);
  grouped.set(word, variants);
}

for (const [word, pronunciations] of Object.entries(curatedPronunciations)) {
  const variants = grouped.get(word) ?? [];
  for (const pronunciation of pronunciations) {
    if (!variants.includes(pronunciation)) variants.push(pronunciation);
  }
  grouped.set(word, variants);
}

// A deliberately small phrase seed proves cross-boundary alignment without
// shipping an unlicensed n-gram corpus. These are authored fixtures, not a
// claim of exhaustive phrase coverage.
const phrases = [
  ["door hinge", [{ phonemes: "D AO1 R HH IH2 N JH", wordStarts: [0, 3] }]],
  ["have at me", [{ phonemes: "HH AE1 V AE0 T M IY2", wordStarts: [0, 3, 5] }]],
  ["been in a", [{ phonemes: "B IH1 N IH0 N AH0", wordStarts: [0, 3, 5] }]],
  ["follow them", [{ phonemes: "F AA1 L OW0 DH EH2 M", wordStarts: [0, 4] }]],
  ["out of me", [{ phonemes: "AW1 T AH0 V M IY2", wordStarts: [0, 2, 4] }]],
  ["power move", [{ phonemes: "P AW1 ER0 M UW2 V", wordStarts: [0, 3] }]],
  ["quiet room", [{ phonemes: "K W AY1 AH0 T R UW2 M", wordStarts: [0, 5] }]],
  ["city lights", [{ phonemes: "S IH1 T IY0 L AY2 T S", wordStarts: [0, 4] }]],
];

const entries = [...grouped.entries()]
  .filter(([word]) => wordnetMetadata.has(word) || curatedExtras.has(word))
  .map(([word, variants]) => {
    const metadata = wordnetMetadata.get(word) ?? { pos: 0, senses: 1 };
    return [word, variants, metadata.pos, metadata.senses];
  })
  .sort(([a], [b]) => a.localeCompare(b));

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputFile,
  JSON.stringify({
    version: "cmudict-npm-3.0.0+rhymegraph-curated-1",
    dialect: "en-US",
    source: "cmu-pronouncing-dictionary@3.0.0 + WordNet 3.1 lemma filter + authored slang overrides",
    entries,
    phrases,
  }),
);

const pronunciationCount = entries.reduce(
  (total, [, variants]) => total + variants.length,
  0,
);

console.log(
  `Wrote ${entries.length.toLocaleString()} words, ${pronunciationCount.toLocaleString()} pronunciations, and ${phrases.length} phrase fixtures to ${outputFile.pathname}`,
);
