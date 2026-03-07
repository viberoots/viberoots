import express from "express";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const htmlTemplatePath = path.resolve(rootDir, "index.html");
const host = "127.0.0.1";
const preferredPort = Number(process.env.PORT || "5173");
const preferredHmrPort = Number(process.env.HMR_PORT || String(preferredPort + 1));
const ssrEntryModule = "/src/entry-server.ts";

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function choosePorts(host, preferredPort, preferredHmrPort) {
  const maxAttempts = 100;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset;
    const hmrPort = preferredHmrPort + offset;
    if (port === hmrPort) continue;
    const [portFree, hmrFree] = await Promise.all([
      canListen(host, port),
      canListen(host, hmrPort),
    ]);
    if (portFree && hmrFree) return { port, hmrPort };
  }
  throw new Error(
    `Unable to find available dev ports near ${preferredPort}/${preferredHmrPort} on ${host}`,
  );
}

function injectHeadMarkup(html, headMarkup) {
  if (!headMarkup) return html;
  if (html.includes("<!--app-head-->")) return html.replace("<!--app-head-->", headMarkup);
  return html.replace("</head>", `${headMarkup}\n  </head>`);
}

async function loadRender(vite, url) {
  try {
    const mod = await vite.ssrLoadModule(ssrEntryModule);
    if (typeof mod?.renderParts === "function") {
      const result = await mod.renderParts(url);
      if (
        !result ||
        typeof result !== "object" ||
        typeof result.appHtml !== "string" ||
        typeof result.styleHtml !== "string"
      ) {
        throw new Error(
          `SSR contract error: ${ssrEntryModule} renderParts(url) must return { appHtml, styleHtml }`,
        );
      }
      return result;
    }
    if (typeof mod?.render !== "function") {
      throw new Error(`SSR contract error: ${ssrEntryModule} must export a render(url) function`);
    }
    const result = await mod.render(url);
    if (typeof result !== "string") {
      throw new Error(`SSR contract error: ${ssrEntryModule} render(url) must return a string`);
    }
    return { appHtml: result, styleHtml: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SSR contract error:")) {
      throw error;
    }
    throw new Error(`SSR contract error: failed to load ${ssrEntryModule}: ${message}`);
  }
}

const app = express();
const { port, hmrPort } = await choosePorts(host, preferredPort, preferredHmrPort);
const vite = await createViteServer({
  root: rootDir,
  appType: "custom",
  server: {
    middlewareMode: true,
    host,
    port,
    strictPort: false,
    hmr: { host, port: hmrPort, clientPort: hmrPort },
  },
});

app.use(vite.middlewares);
app.use("*", async (req, res) => {
  try {
    const url = req.originalUrl;
    const template = await readFile(htmlTemplatePath, "utf8");
    const transformed = await vite.transformIndexHtml(url, template);
    const rendered = await loadRender(vite, url);
    const html = injectHeadMarkup(
      transformed.replace("<!--app-html-->", rendered.appHtml),
      rendered.styleHtml,
    );
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
