import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const htmlTemplatePath = path.resolve(rootDir, "index.html");
const host = "127.0.0.1";
const port = Number(process.env.PORT || "5173");
const ssrEntryModule = "/src/entry-server.ts";

async function loadRender(vite, url) {
  try {
    const mod = await vite.ssrLoadModule(ssrEntryModule);
    if (typeof mod?.render !== "function") {
      throw new Error(`SSR contract error: ${ssrEntryModule} must export a render(url) function`);
    }
    const result = await mod.render(url);
    if (typeof result !== "string") {
      throw new Error(`SSR contract error: ${ssrEntryModule} render(url) must return a string`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SSR contract error:")) {
      throw error;
    }
    throw new Error(`SSR contract error: failed to load ${ssrEntryModule}: ${message}`);
  }
}

const app = express();
const vite = await createViteServer({
  root: rootDir,
  appType: "custom",
  server: { middlewareMode: true, host, port, strictPort: true },
});

app.use(vite.middlewares);
app.use("*", async (req, res) => {
  try {
    const url = req.originalUrl;
    const template = await readFile(htmlTemplatePath, "utf8");
    const transformed = await vite.transformIndexHtml(url, template);
    const appHtml = await loadRender(vite, url);
    const html = transformed.replace("<!--app-html-->", appHtml);
    res.status(200).setHeader("content-type", "text/html; charset=utf-8").end(html);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    vite.ssrFixStacktrace(err);
    res.status(500).setHeader("content-type", "text/plain; charset=utf-8").end(err.message);
  }
});

app.listen(port, host, () => {
  console.log(`[webapp-ssr-vite] dev listening on http://${host}:${port}`);
});
