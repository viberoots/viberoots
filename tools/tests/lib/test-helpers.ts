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
    const goOnly = process.env.TEST_PARTIAL_CLONE_GO_ONLY === "1";
    const excludes = [
      "/buck-out",
      "/.git",
      "/apps",
      "/libs",
      "/node_modules",
      "/coverage",
      "/.clinic",
      "/.direnv",
      "/result",
      "/tools/buck/graph.json",
    ];
    if (goOnly) {
      excludes.push("/cpp", "/tools/nix/templates/cpp.nix", "/tools/scaffolding/templates/cpp");
    }
    if (process.env.TEST_EXCLUDE_CPP_REQS === "1") {
      excludes.push("/cpp/defs.bzl", "/tools/nix/templates/cpp.nix");
    }
    const args = excludes.map((e) => ["--exclude", e]).flat();
    await $`rsync -a ${args} ./ ${tmp}/`;
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
  // Ensure Buck prelude and config exist inside the temp repo so @prelude loads work
  {
    let preludePath = "";
    // Prefer the checked-in prelude from the workspace copy
    const localPrelude = path.join(tmp, "prelude");
    try {
      const fs = await import("fs-extra");
      if (await fs.pathExists(localPrelude)) preludePath = localPrelude;
    } catch {}
    // If not available, best-effort: obtain nix prelude path (non-fatal if it fails)
    if (!preludePath) {
      try {
        const pre = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
        const out = String(pre.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        if (out) preludePath = path.join(out, "prelude").replaceAll("\\", "/");
      } catch {}
      if (!preludePath) {
        try {
          const ev = await $({ cwd: tmp, stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
          const p = String(ev.stdout || "").trim();
          if (p) preludePath = path.join(p, "prelude").replaceAll("\\", "/");
        } catch {}
      }
    }
    if (preludePath) {
      await $({ cwd: tmp })`bash -lc ${`set -euo pipefail
        printf '.\n' > .buckroot
        [ -e prelude ] || ln -s "${preludePath}" prelude
        cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
        mkdir -p toolchains
        printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
      `}`;
    }
  }
  let shouldUseDirenv = true;
  try {
    const direnvStatus = await $({ stdio: "pipe" })`direnv status --json`;
    const direnvStatusJson = JSON.parse(direnvStatus.stdout);
    if (direnvStatusJson.config.loadadRC != null) {
      shouldUseDirenv = false;
    }
  } catch {}
  let envOut = shouldUseDirenv
    ? await timeAsync(
        `direnvExport(${path.basename(tmp)})`,
        async () =>
          $({
            cwd: tmp,
            stdio: "pipe",
          })`bash --noprofile --norc -c 'if command -v direnv >/dev/null 2>&1; then direnv allow . >/dev/null 2>&1 || true; eval "$(direnv export bash)"; env -0; else printf ""; fi'`,
      )
    : ({ stdout: "" } as any);
  // Fallback: if direnv is unavailable (common in CI or minimal shells), attempt to
  // capture a dev-shell environment via Nix so tools like pnpm are on PATH.
  if (!String((envOut as any).stdout || "")) {
    try {
      envOut = await timeAsync(
        `nixDevelopExport(${path.basename(tmp)})`,
        async () =>
          $({
            cwd: tmp,
            stdio: "pipe",
          })`bash --noprofile --norc -c 'if command -v nix >/dev/null 2>&1; then nix develop --accept-flake-config -c env -0; else printf ""; fi'`,
      );
    } catch {
      // ignore; proceed with current environment
    }
  }
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
  // Ensure repo-aware bin helpers (e.g., tools/bin/build, verify) operate on the temp copy
  // Keep WORKSPACE_ROOT as the temp repo for file operations
  exportEnv.WORKSPACE_ROOT = tmp;
  // Ensure zx init import always points to the real workspace, not the temp copy
  exportEnv.ZX_INIT = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
  exportEnv.NODE_PATH = [
    path.join(tmp, "node_modules"),
    path.join(process.cwd(), "node_modules"),
    exportEnv.NODE_PATH || "",
  ]
    .filter(Boolean)
    .join(path.delimiter);
  // Do not mutate PATH; rely on direnv-provided environment from the dev shell.
  const nodeOpts = ["--experimental-strip-types", `--import ${exportEnv.ZX_INIT}`];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        console.error(`KEEP_TMP ${tmp}`);
        await fsp
          .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
          .catch(() => {});
      } catch {}
    }
    return await fn(tmp, _$);
  } finally {
    // Best-effort: stop any buck2 daemon for this temp repo to prevent buckd accumulation.
    try {
      await _$`buck2 kill`;
    } catch {}
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
        console.warn("warning: failed to remove temp test dir:", err);
      });
    }
    console.error(`[timing] runInTemp(${name}) done`);
  }
}
