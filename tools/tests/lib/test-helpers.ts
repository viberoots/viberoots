#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

import { $ } from "zx";

async function rewriteCoverageUrls(tmpRoot: string) {
  try {
    const repoRoot = process.cwd();
    const covDir = path.join(repoRoot, "coverage", "raw");
    const files = await fsp.readdir(covDir).catch(() => [] as string[]);
    const fromPrefix1 = "file://" + tmpRoot; // e.g., file:///var/folders/...
    const fromPrefix2 = tmpRoot.startsWith("/") ? "file:///" + tmpRoot.slice(1) : fromPrefix1;
    // macOS sometimes resolves via /private/var/... — handle that alias too
    const privateTmp = tmpRoot.startsWith("/var/") ? "/private" + tmpRoot : tmpRoot;
    const fromPrefix3 = "file://" + privateTmp;
    const fromPrefix4 = privateTmp.startsWith("/") ? "file:///" + privateTmp.slice(1) : fromPrefix3;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(covDir, f);
      let txt = await fsp.readFile(p, "utf8").catch(() => "");
      if (!txt || (!txt.includes(fromPrefix1) && !txt.includes(fromPrefix2))) continue;
      let json: any;
      try {
        json = JSON.parse(txt);
      } catch {
        continue;
      }
      const toPrefix = "file://" + repoRoot;
      const rewriter = (u: string) =>
        u.startsWith(fromPrefix1)
          ? toPrefix + u.slice(fromPrefix1.length)
          : u.startsWith(fromPrefix2)
            ? toPrefix + u.slice(fromPrefix2.length)
            : u.startsWith(fromPrefix3)
              ? toPrefix + u.slice(fromPrefix3.length)
              : u.startsWith(fromPrefix4)
                ? toPrefix + u.slice(fromPrefix4.length)
                : u;
      // Rewrite result[].url
      if (Array.isArray(json.result)) {
        for (const e of json.result) {
          if (e && typeof e.url === "string") e.url = rewriter(e.url);
        }
      }
      // Rewrite source-map-cache keys
      if (json["source-map-cache"] && typeof json["source-map-cache"] === "object") {
        const smc = json["source-map-cache"] as Record<string, any>;
        const next: Record<string, any> = {};
        for (const [k, v] of Object.entries(smc)) {
          const nk = rewriter(k);
          next[nk] = v;
        }
        json["source-map-cache"] = next;
      }
      await fsp.writeFile(p, JSON.stringify(json), "utf8");
    }
  } catch {
    // best-effort; ignore failures
  }
}

export async function rsyncRepoTo(tmp: string) {
  await $`rsync -a --exclude "buck-out" --exclude ".git" --exclude "libs" --exclude ".tmp" --exclude "node_modules" --exclude "coverage" --exclude ".clinic" ./ ${tmp}/`;
}

export async function mktemp(prefix = "test-") {
  const base = path.join(process.cwd(), ".tmp");
  await fsp.mkdir(base, { recursive: true });
  return await fsp.mkdtemp(path.join(base, prefix));
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
): Promise<T> {
  const tmp = await mktemp(name + "-");
  await rsyncRepoTo(tmp);
  // Load direnv environment for the temp dir so devShell linking/PATH are active when available.
  // If direnv is not present, skip altering the environment to preserve the parent devShell PATH.
  const envOut = await $({
    cwd: tmp,
    stdio: "pipe",
  })`bash -c 'if command -v direnv >/dev/null 2>&1; then direnv allow . >/dev/null 2>&1 || true; eval "$(direnv export bash)"; env -0; else printf ""; fi'`;
  const exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
  const injected = String(envOut.stdout || "");
  for (const entry of injected ? injected.split("\0") : []) {
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx > 0) {
      const k = entry.slice(0, idx);
      const v = entry.slice(idx + 1);
      exportEnv[k] = v;
    }
  }
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    return await fn(tmp, _$);
  } finally {
    // Rewrite any raw coverage URLs that point to the soon-to-be-deleted tmp to the repo root
    await rewriteCoverageUrls(tmp).catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true }).catch((err) => {
      // Non-fatal: cleanup of temp dir may fail on CI; ignore but log for visibility.
      console.warn("warning: failed to remove temp test dir:", err);
    });
  }
}
