#!/usr/bin/env zx-wrapper
import { type ChildProcess } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { terminateChildTree } from "../../lib/process-tree";

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

export async function httpGet(
  url: string,
  timeoutMs = Number(process.env.TEST_HTTP_GET_TIMEOUT_MS || "5000"),
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`response timed out after ${timeoutMs}ms for ${url}`));
      });
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms for ${url}`));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function waitForHttpOk(url: string, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const remainingMs = Math.max(250, timeoutMs - (Date.now() - start));
      const res = await httpGet(url, Math.min(5000, remainingMs));
      if (res.status === 200) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

export async function waitForChildHttpOk(
  child: ChildProcess,
  url: string,
  timeoutMs = 45000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(
        `server exited before readiness check completed (exitCode=${String(
          child.exitCode,
        )}, signal=${String(child.signalCode)})`,
      );
    }
    try {
      const remainingMs = Math.max(250, timeoutMs - (Date.now() - start));
      const res = await httpGet(url, Math.min(5000, remainingMs));
      if (res.status === 200) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

export async function stopServer(child: ChildProcess): Promise<void> {
  await terminateChildTree(child, 5000);
  try {
    if (child.exitCode == null) await Promise.race([once(child, "exit"), sleep(500)]);
  } catch {}
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

function decodeViteFsPathname(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  if (!decoded.startsWith("/@fs/")) return null;
  let fsPath = decoded.slice("/@fs".length);
  while (fsPath.startsWith("//")) fsPath = fsPath.slice(1);
  return fsPath;
}

async function canonicalPath(input: string): Promise<string> {
  const resolved = path.resolve(input);
  try {
    const real = await fsp.realpath(resolved);
    return process.platform === "win32" ? real.toLowerCase() : real;
  } catch {
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
}

export async function moduleUrlResolvesToFile(
  moduleUrl: string,
  filePath: string,
): Promise<boolean> {
  let moduleFsPath: string | null = null;
  try {
    const parsed = new URL(moduleUrl);
    moduleFsPath = decodeViteFsPathname(parsed.pathname);
  } catch {
    return false;
  }
  if (!moduleFsPath) return false;
  const [moduleCanonical, fileCanonical] = await Promise.all([
    canonicalPath(moduleFsPath),
    canonicalPath(filePath),
  ]);
  return moduleCanonical === fileCanonical;
}

function transformEsmForEval(
  code: string,
  moduleUrl: string,
  opts: { importCacheBuster?: string } = {},
): { code: string; exportEntries: Array<{ exportName: string; localName: string }> } {
  const exportEntries: Array<{ exportName: string; localName: string }> = [];
  let out = code;
  out = out.replace(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/g,
    (_, local, spec) => {
      const depUrl = cacheBustModuleUrl(
        toAbsoluteModuleUrl(moduleUrl, String(spec)),
        opts.importCacheBuster,
      );
      return `const { default: ${String(local)} } = await __import("${depUrl}");`;
    },
  );
  out = out.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, (_, imports, spec) => {
    const depUrl = cacheBustModuleUrl(
      toAbsoluteModuleUrl(moduleUrl, String(spec)),
      opts.importCacheBuster,
    );
    return `const {${String(imports)}} = await __import("${depUrl}");`;
  });
  out = out.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (_, name) => {
    exportEntries.push({ exportName: String(name), localName: String(name) });
    return `const ${String(name)} =`;
  });
  out = out.replace(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g, (_, name) => {
    exportEntries.push({ exportName: String(name), localName: String(name) });
    return `function ${String(name)}(`;
  });
  if (/export\s+default\b/.test(out)) {
    out = out.replace(/export\s+default\b/g, "const __default_export__ =");
    exportEntries.push({ exportName: "default", localName: "__default_export__" });
  }
  out = out.replace(/if\s*\(\s*import\.meta\.hot\s*\)\s*\{[\s\S]*?\}\s*$/gm, "");
  out = out.replace(/import\.meta\.hot\.[^\n;]+;?/g, "");
  out = out.replace(/export\s*\{[^}]*\};?/g, "");
  return { code: out, exportEntries };
}

function cacheBustModuleUrl(moduleUrl: string, token?: string): string {
  if (!token) return moduleUrl;
  const parsed = new URL(moduleUrl);
  parsed.searchParams.set("__vbr_eval", token);
  return parsed.toString();
}

export async function evaluateRenderedAppText(
  mainModuleUrl: string,
  opts: { cacheBustImports?: boolean } = {},
): Promise<string> {
  const moduleCache = new Map<string, Record<string, unknown>>();
  const appEl = { textContent: "" };
  const importCacheBuster = opts.cacheBustImports
    ? new URL(mainModuleUrl).searchParams.get("t") || String(Date.now())
    : undefined;
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
    const transformed = transformEsmForEval(res.body, moduleUrl, { importCacheBuster });
    const exportObjectSrc =
      transformed.exportEntries.length === 0
        ? "{}"
        : `{ ${transformed.exportEntries.map(({ exportName, localName }) => `"${exportName}": ${localName}`).join(", ")} }`;
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
