import express from "express";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readServerWasmContractByteLength } from "./wasm-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, "../client");
const port = Number(process.env.PORT || "4173");
const host = process.env.HOST || "0.0.0.0";
const entryServerPath = path.resolve(__dirname, "entry-server.js");
const baseShellStyles = [
  "html,body,#app{margin:0;min-height:100%;overflow:hidden;overscroll-behavior:none;}",
  '#app[data-client-hydrated="false"]{visibility:hidden;}',
  '#app[data-ui-ready="false"]{visibility:hidden;}',
  'body{background:#27446b;color:#f8fafc;user-select:none;-webkit-user-select:none;touch-action:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
].join("");
const pwaHeadTags = [
  '<meta name="description" content="A polished pleomino puzzle you can install as an app." />',
  '<meta name="theme-color" content="#0b1324" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="Pleomino" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
].join("\n");
type Rendered = { appHtml: string; styleHtml: string };

const app = express();
async function requireServerEntry(p: string): Promise<void> {
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`SSR contract error: missing serverEntry at ${p}`);
  }
}

async function requireClientDir(p: string): Promise<void> {
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`SSR contract error: missing clientDir at ${p}`);
  }
}

await requireServerEntry(entryServerPath);
await requireClientDir(clientDir);
app.use(express.static(clientDir));
const serverWasmByteLength = await readServerWasmContractByteLength();

async function loadRender(): Promise<(url: string) => Rendered> {
  try {
    const mod = (await import(pathToFileURL(entryServerPath).href)) as {
      render?: (url: string) => string;
      renderParts?: (url: string) => Rendered;
    };
    if (typeof mod.renderParts === "function") {
      return (url: string) => mod.renderParts!(url);
    }
    if (typeof mod.render !== "function") {
      throw new Error(
        "SSR contract error: dist/server/entry-server.js must export a render(url) function",
      );
    }
    return (url: string) => ({ appHtml: mod.render!(url), styleHtml: "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SSR contract error:")) {
      throw error;
    }
    throw new Error(`SSR contract error: failed to load dist/server/entry-server.js: ${message}`);
  }
}
const render = await loadRender();

app.get("*", (req, res) => {
  const rendered = render(req.originalUrl);
  const styleHtml = rendered.styleHtml;
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "    <title>Pleomino</title>",
    `    ${pwaHeadTags}`,
    `    <style>${baseShellStyles}</style>`,
    styleHtml ? `    ${styleHtml}` : "",
    "  </head>",
    "  <body>",
    `    <div data-server-wasm-bytes="${serverWasmByteLength}"></div>`,
    `    <div id="app" data-ssr-marker="vite" data-client-hydrated="false" data-ui-ready="false">${rendered.appHtml}</div>`,
    '    <script type="module" src="/entry-client.js"></script>',
    "  </body>",
    "</html>",
  ].join("\n");
  res
    .status(200)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setHeader("x-server-wasm-bytes", String(serverWasmByteLength))
    .end(html);
});

app.listen(port, host, () => {
  console.log(`[webapp-ssr-vite] listening on http://${host}:${port}`);
});
