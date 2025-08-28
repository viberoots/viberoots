#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const ENABLE_TIMING = process.env.TEST_TIMING === "1";
function logTiming(label: string, ms: number) {
  if (!ENABLE_TIMING) return;
  try {
    console.error(`[timing] ${label}: ${ms.toFixed(1)}ms`);
  } catch {}
}
async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logTiming(label, performance.now() - t0);
  }
}

let preflightDone = false;
async function ensurePnpmStoreHashValid() {
  if (preflightDone) return;
  preflightDone = true;
  try {
    await $`nix build .#pnpm-store --no-link --accept-flake-config`;
  } catch (e: any) {
    const out = String((e && e.stderr) || (e && e.stdout) || e || "");
    const hint = "Run: pnpm tsx tools/dev/update-pnpm-hash.ts";
    if (/hash mismatch in fixed-output derivation/i.test(out)) {
      console.error(`test preflight: pnpm-store hash mismatch. ${hint}`);
    } else {
      console.error(`test preflight: pnpm-store build failed. ${hint}`);
    }
    process.exit(1);
  }
}

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
  await timeAsync(`rsyncRepoTo(${path.basename(tmp)})`, async () => {
    await $`rsync -a --exclude "buck-out" --exclude ".git" --exclude "libs" --exclude "node_modules" --exclude "coverage" --exclude ".clinic" --exclude ".direnv" --exclude "result" ./ ${tmp}/`;
  });
}

export async function mktemp(prefix = "test-") {
  const base = os.tmpdir();
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
  const overallStart = performance.now();
  const tmp = await mktemp(name + "-");
  await rsyncRepoTo(tmp);
  await ensurePnpmStoreHashValid();
  // Load direnv environment for the temp dir so devShell linking/PATH are active when available.
  // If already in a nix dev shell, skip direnv to avoid redundant flake eval and shellHook.
  // Additionally, if the required tools are already available on PATH (e.g., secretspec), skip direnv.
  async function isOnPath(bin: string): Promise<boolean> {
    try {
      await $({ stdio: "pipe" })`bash --noprofile --norc -c ${`command -v ${bin} >/dev/null 2>&1`}`;
      return true;
    } catch {
      return false;
    }
  }
  const skipDirenv = process.env.JSON_CLI_SKIP_DIRENV === "1";
  let shouldUseDirenv = !process.env.IN_NIX_SHELL && !skipDirenv;
  try {
    if (await isOnPath("secretspec")) {
      shouldUseDirenv = false;
    }
  } catch {}
  const envOut = shouldUseDirenv
    ? await timeAsync(
        `direnvExport(${path.basename(tmp)})`,
        async () =>
          $({
            cwd: tmp,
            stdio: "pipe",
          })`bash --noprofile --norc -c 'if command -v direnv >/dev/null 2>&1; then direnv allow . >/dev/null 2>&1 || true; eval "$(direnv export bash)"; env -0; else printf ""; fi'`,
      )
    : ({ stdout: "" } as any);
  const exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
  const injected = String((envOut as any).stdout || "");
  for (const entry of injected ? injected.split("\0") : []) {
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx > 0) {
      const k = entry.slice(0, idx);
      const v = entry.slice(idx + 1);
      exportEnv[k] = v;
    }
  }
  // Ensure module resolution inside temp can find repo's node_modules (for eslint plugins, etc.)
  exportEnv.NODE_PATH = [path.join(process.cwd(), "node_modules"), exportEnv.NODE_PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);
  // Ensure node child processes pick up zx-init resolver and type stripping
  const nodeOpts = [
    "--experimental-strip-types",
    `--import ${path.join(process.cwd(), "tools", "dev", "zx-init.mjs")}`,
  ];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    if (process.env.TEST_KEEP_TMP === "1") {
      // Enable runner debug to a file inside the tmp to survive stdout suppression
      exportEnv.JSON_CLI_DEBUG = "1";
      exportEnv.JSON_CLI_DEBUG_FILE = path.join(tmp, "jc.runner.log");
      try {
        console.error(`KEEP_TMP ${tmp}`);
        await fsp
          .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
          .catch(() => {});
      } catch {}
    }
    return await fn(tmp, _$);
  } finally {
    // Rewrite any raw coverage URLs that point to the soon-to-be-deleted tmp to the repo root
    await timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () =>
      rewriteCoverageUrls(tmp).catch(() => {}),
    );
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        console.error(`KEEP_TMP ${tmp}`);
        const logFile = path.join(process.cwd(), "test-tmp-paths.log");
        await fsp.appendFile(logFile, tmp + "\n", "utf8").catch(() => {});
      } catch {}
    } else {
      await fsp.rm(tmp, { recursive: true, force: true }).catch((err) => {
        // Non-fatal: cleanup of temp dir may fail on CI; ignore but log for visibility.
        console.warn("warning: failed to remove temp test dir:", err);
      });
    }
    logTiming(`runInTemp(${name})`, performance.now() - overallStart);
  }
}
