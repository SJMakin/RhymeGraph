import { withBasePath } from "@/lib/public-path";
import Link from "next/link";

export const metadata = {
  title: "Open-source notices — RhymeGraph",
  description: "Licences and attribution for RhymeGraph's local language resources.",
};

const licenceFiles = [
  ["Apache License 2.0", "/licenses/Apache-2.0.txt"],
  ["CMU Pronouncing Dictionary", "/licenses/cmudict-upstream.txt"],
  ["CMU npm wrapper (ISC)", "/licenses/cmu-pronouncing-dictionary-ISC.txt"],
  ["SUBTLEX word frequencies (ISC)", "/licenses/SUBTLEX-word-frequencies-ISC.txt"],
  ["WordNet 3.0 terms", "/licenses/WordNet-3.0.txt"],
  ["ONNX Runtime (MIT)", "/licenses/ONNX-Runtime-MIT.txt"],
  ["ONNX Runtime third-party notices", "/licenses/ONNX-Runtime-ThirdPartyNotices.txt"],
  ["Web runtime licences (React, Next.js, Lucide, Jinja)", "/licenses/Web-Runtime-Licences.txt"],
] as const;

export default function NoticesPage() {
  return (
    <main className="notice-page">
      <Link className="notice-back" href="/">← Back to the studio</Link>
      <p className="eyebrow">LOCAL, OPEN BUILDING BLOCKS</p>
      <h1>Open-source notices</h1>
      <p className="notice-lede">
        RhymeGraph keeps its pronunciation search and semantic model on your device.
        These are the projects and datasets that make that possible.
      </p>

      <section>
        <h2>Pronunciation and lexical data</h2>
        <p>
          The compact pronunciation pack derives from the Carnegie Mellon University
          Pronouncing Dictionary through the ISC-licensed <code>cmu-pronouncing-dictionary</code>
          package. WordNet indexes provide lemma and part-of-speech metadata, while
          SUBTLEX-US spoken-frequency counts retain common inflections and improve utility ranking;
          they are not pronunciation or dialect data. RhymeGraph adds a small, transparent set of
          slang/reference pronunciations, eight pack fixtures, and 151 ordinary performance-phrase
          building blocks composed from the word lexicon. None is extracted from lyrics or an artist corpus.
        </p>
      </section>

      <section>
        <h2>On-device meaning</h2>
        <p>
          Semantic retrieval uses <code>sentence-transformers/all-MiniLM-L6-v2</code>,
          Transformers.js 4.2.0, ONNX Runtime Web, and a RhymeGraph-built int8 index
          of bounded WordNet gloss/POS documents. WordNet also supplies a bounded primary
          definition when available. The model, tokenizer, index, runtime, and WASM backend
          are bundled locally; remote model fallback is disabled.
        </p>
      </section>

      <section>
        <h2>Application runtime</h2>
        <p>
          The static interface includes React, React DOM, Next.js, and Lucide icons.
          The semantic worker also bundles the MIT-licensed <code>@huggingface/jinja</code>
          parser used by Transformers.js. Their copyright notices and licence texts are
          included with the data, model, and ONNX notices below.
        </p>
      </section>

      <section>
        <h2>Licence texts</h2>
        <div className="notice-links">
          {licenceFiles.map(([label, href]) => (
            <a key={href} href={withBasePath(href)}>{label}<span>TXT ↗</span></a>
          ))}
        </div>
      </section>

      <p className="notice-footnote">
        Model revision <code>826711e54e001c83835913827a843d8dd0a1def9</code> ·
        ONNX Runtime commit <code>b7804b056c</code>
      </p>
    </main>
  );
}
