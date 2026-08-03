import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    hostname: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "3000" },
    root: { type: "string", default: "out" },
    "base-path": { type: "string", default: "" },
  },
});

const root = resolve(values.root);
const basePath = values["base-path"]
  ? `/${values["base-path"].replace(/^\/+|\/+$/g, "")}`
  : "";
const port = Number.parseInt(values.port, 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid port: ${values.port}`);
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".onnx", "application/octet-stream"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
]);

async function existingFile(pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  const candidates = pathname.endsWith("/")
    ? [`${relativePath}index.html`]
    : [relativePath, `${relativePath}/index.html`, `${relativePath}.html`];

  for (const candidate of candidates) {
    const filePath = resolve(root, candidate);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) continue;
    try {
      if ((await stat(filePath)).isFile()) return filePath;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
    if (basePath) {
      if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
        response.writeHead(404).end("Not found");
        return;
      }
      pathname = pathname.slice(basePath.length) || "/";
    }

    const filePath = await existingFile(pathname);
    if (!filePath) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.setHeader(
      "Content-Type",
      contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    );
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "HEAD") {
      response.writeHead(200).end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : "Server error");
  }
});

server.listen(port, values.hostname, () => {
  console.log(`Serving ${root}${basePath || "/"} at http://${values.hostname}:${port}${basePath}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
