import { copyFile } from "node:fs/promises";
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

function writeCurrentWorkerAliases(): Plugin {
  return {
    name: "write-current-worker-aliases",
    async writeBundle(options, bundle) {
      const outputDirectory = options.dir;
      if (!outputDirectory) throw new Error("Worker build requires an output directory.");
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) continue;
        await copyFile(
          resolve(outputDirectory, output.fileName),
          resolve(outputDirectory, `${output.name}.js`),
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
  plugins: [avoidMistralKeyFalsePositive(), writeCurrentWorkerAliases()],
  define: {
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(basePath),
  },
  build: {
    target: "es2022",
    outDir: resolve(import.meta.dirname, "../public/workers"),
    // Versioned entries remain available for already-open tabs across deploys.
    // The unversioned aliases are refreshed for pre-v0.3 clients.
    emptyOutDir: false,
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        "phonetic.worker": resolve(import.meta.dirname, "../lib/phonetic-search/phonetic.worker.ts"),
        "semantic.worker": resolve(import.meta.dirname, "../lib/semantic/semantic.worker.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].v3.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
