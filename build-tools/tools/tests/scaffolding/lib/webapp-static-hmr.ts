#!/usr/bin/env zx-wrapper
import { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  server.close();
  if (!addr || typeof addr !== "object" || typeof addr.port !== "number") {
    throw new Error("failed to reserve an ephemeral port");
  }
  return addr.port;
}

export async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function waitForHttpOk(url: string, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(url);
      if (res.status === 200) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

export async function stopServer(child: ChildProcess): Promise<void> {
  try {
    if (child.pid) child.kill("SIGINT");
  } catch {}
  try {
    await Promise.race([once(child, "exit"), sleep(5000)]);
  } catch {}
  if (child.exitCode == null) {
    try {
      if (child.pid) child.kill("SIGKILL");
    } catch {}
  }
}

export function viteFsUrlFor(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `/@fs${normalized}` : `/@fs/${normalized}`;
}

export function extractImportedUrl(moduleBody: string, includesNeedle: string): string {
  const importRe = /from\s+["']([^"']+)["']/g;
  while (true) {
    const next = importRe.exec(moduleBody);
    if (!next) break;
    const spec = String(next[1] || "");
    if (spec.includes(includesNeedle)) return spec;
  }
  throw new Error(`failed to find imported module containing '${includesNeedle}'`);
}

export function toAbsoluteModuleUrl(baseUrl: string, maybeRelative: string): string {
  if (maybeRelative.startsWith("http://") || maybeRelative.startsWith("https://")) {
    return maybeRelative;
  }
  return new URL(maybeRelative, baseUrl).toString();
}

function transformEsmForEval(
  code: string,
  moduleUrl: string,
): { code: string; exportNames: string[] } {
  const exportNames: string[] = [];
  let out = code;
  out = out.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, (_, imports, spec) => {
    const depUrl = toAbsoluteModuleUrl(moduleUrl, String(spec));
    return `const {${String(imports)}} = await __import("${depUrl}");`;
  });
  out = out.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (_, name) => {
    exportNames.push(String(name));
    return `const ${String(name)} =`;
  });
  out = out.replace(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_, name) => {
    exportNames.push(String(name));
    return `function ${String(name)}(`;
  });
  out = out.replace(/if\s*\(\s*import\.meta\.hot\s*\)\s*\{[\s\S]*?\}\s*$/gm, "");
  out = out.replace(/import\.meta\.hot\.[^\n;]+;?/g, "");
  out = out.replace(/export\s*\{[^}]*\};?/g, "");
  return { code: out, exportNames };
}

export async function evaluateRenderedAppText(mainModuleUrl: string): Promise<string> {
  const moduleCache = new Map<string, Record<string, unknown>>();
  const appEl = { textContent: "" };
  const fakeDocument = {
    getElementById(id: string) {
      return id === "app" ? appEl : null;
    },
  };

  const loadModule = async (moduleUrl: string): Promise<Record<string, unknown>> => {
    const cached = moduleCache.get(moduleUrl);
    if (cached) return cached;
    const res = await httpGet(moduleUrl);
    if (res.status !== 200) {
      throw new Error(`expected 200 from module url '${moduleUrl}', got ${res.status}`);
    }
    const transformed = transformEsmForEval(res.body, moduleUrl);
    const exportObjectSrc =
      transformed.exportNames.length === 0
        ? "{}"
        : `{ ${transformed.exportNames.map((name) => `${name}: ${name}`).join(", ")} }`;
    const runnerBody =
      '"use strict"; return (async () => {\n' +
      transformed.code +
      "\n; return " +
      exportObjectSrc +
      "; })();";
    const runner = new Function("__import", "document", runnerBody) as (
      __import: (url: string) => Promise<Record<string, unknown>>,
      document: typeof fakeDocument,
    ) => Promise<Record<string, unknown>>;
    const exports = await runner(loadModule, fakeDocument);
    moduleCache.set(moduleUrl, exports);
    return exports;
  };

  await loadModule(mainModuleUrl);
  return String(appEl.textContent || "");
}
