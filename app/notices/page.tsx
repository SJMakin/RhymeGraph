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
  ["WordNet 3.0 terms", "/licenses/WordNet-3.0.txt"],
  ["ONNX Runtime (MIT)", "/licenses/ONNX-Runtime-MIT.txt"],
  ["ONNX Runtime third-party notices", "/licenses/ONNX-Runtime-ThirdPartyNotices.txt"],
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
          package. WordNet indexes are used at build time for lemma and part-of-speech metadata.
          A small set of clearly authored slang pronunciations and phrase fixtures is added by RhymeGraph.
        </p>
      </section>

      <section>
        <h2>On-device meaning</h2>
        <p>
          Semantic reranking uses <code>sentence-transformers/all-MiniLM-L6-v2</code>,
          Transformers.js 4.2.0, and ONNX Runtime Web. The model, tokenizer, runtime,
          and WASM backend are bundled locally; remote model fallback is disabled.
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
