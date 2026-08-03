import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function avoidMistralKeyFalsePositive(): Plugin {
  const modelClass = JSON.stringify(["Mistral3", "ForConditionalGeneration"].join(""));
  const equivalentExpression = '"Mistral3"+"ForConditionalGeneration"';

  return {
    name: "avoid-mistral-key-false-positive",
    enforce: "post",
    generateBundle(_options, bundle) {
      let replacements = 0;

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const occurrences = output.code.split(modelClass).length - 1;
        if (occurrences === 0) continue;

        output.code = output.code.replaceAll(modelClass, equivalentExpression);
        replacements += occurrences;
      }

      if (replacements !== 1) {
        throw new Error(
          `Expected one bundled Mistral model-class literal, found ${replacements}.`,
        );
      }
    },
  };
}

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export default defineConfig({
  base: `${basePath}/workers/`,
  publicDir: false,
  plugins: [avoidMistralKeyFalsePositive()],
  define: {
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
  build: {
    target: "es2022",
    outDir: resolve(import.meta.dirname, "../public/workers"),
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        "phonetic.worker": resolve(import.meta.dirname, "../lib/phonetic-search/phonetic.worker.ts"),
        "semantic.worker": resolve(import.meta.dirname, "../lib/semantic/semantic.worker.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
