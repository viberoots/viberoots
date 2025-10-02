#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./install/gomod2nix.ts";

function shouldInstallDeps(): boolean {
  // Placeholder for future heuristics (node_modules symlink, gomod2nix freshness, etc.)
  return true;
}

function repoRoot(): string {
  // Resolve repo root based on this script path (URL) to be callable from any CWD
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..");
}

function zxNodeBase(): string {
  const zxInit = path.resolve(repoRoot(), "tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

async function ensureBuckPreludeConfig(): Promise<void> {
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: repoRoot(),
    })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
    const out = String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop();
    if (!out) throw new Error("unable to build .#buck2-prelude");
    const preludePath = `${out}/prelude`;
    await $({ cwd: repoRoot() })`bash -lc ${`set -euo pipefail
      : > .buckroot
      rm -f prelude && ln -s "${preludePath}" prelude
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
    `}`;

    // Ensure toolchains/ has its own .buckconfig so Buck uses TARGETS there too
    await $({ cwd: repoRoot() })`bash -lc ${`set -euo pipefail
      mkdir -p toolchains
      cat > toolchains/.buckconfig <<'EOF'
[buildfile]
name = TARGETS
EOF
    `}`;
  } catch (e) {
    console.error("failed to ensure Buck prelude config:", e);
    throw e;
  }
}

async function main() {
  const isCI = process.env.CI === "true";
  // Ensure process.cwd() is the repo root so helpers using it behave consistently
  try {
    process.chdir(repoRoot());
  } catch {}
  const argsIn = process.argv.slice(2);
  const known = new Set([
    "build",
    "test",
    "run",
    "cquery",
    "query",
    "install",
    "kill",
    "server",
    "clean",
  ]);
  let subcmd = "build";
  let restArgs = argsIn;
  // Global opt-out for materialization
  let materialize = true;
  if (argsIn.length === 0) {
    restArgs = ["//..."];
  } else if (known.has(argsIn[0])) {
    subcmd = argsIn[0];
    restArgs = argsIn.slice(1);
  } else if (/^(?:\/\/|root\/\/|:)/.test(argsIn[0])) {
    // Treat bare target form as `buck2 build <targets...>`
    subcmd = "build";
    restArgs = argsIn;
  } else {
    // Fallback: pass through, but default to build if unrecognized
    subcmd = "build";
    restArgs = argsIn;
  }

  // Recognize opt-out flag anywhere after subcmd
  const filtered: string[] = [];
  for (const a of restArgs) {
    if (a === "--no-materialize") {
      materialize = false;
      continue;
    }
    filtered.push(a);
  }
  restArgs = filtered;

  // Environment guard: ensure required tools and Nix features are present
  await $({ stdio: "inherit", cwd: repoRoot() })`tools/dev/startup-check.ts`;

  // Ensure Buck prelude and config are aligned to flake buck2-prelude
  await ensureBuckPreludeConfig();

  // Clean any stray buck-go-* dirs at repo root from previous runs
  await $({ stdio: "ignore", cwd: repoRoot() })`bash -lc 'rm -rf buck-go-*'`.nothrow();

  if (!isCI && shouldInstallDeps()) {
    const nodeBase = zxNodeBase();
    const nodeBin = process.execPath || "node";
    await $({
      stdio: "inherit",
      cwd: repoRoot(),
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/dev/install-deps.ts")} --glue-only`}`;
    // Ensure gomod2nix.toml exists for Go modules (repo root and per app/lib) without running full install
    try {
      await runGomod2nixGenerate(false, false);
      await runGomod2nixScanAll(false, false);
    } catch (e) {
      console.warn("[dev-build] gomod2nix generation skipped:", e);
    }
    // Refresh Buck graph so graph-generator sees newest targets
    await $({
      stdio: "inherit",
      cwd: repoRoot(),
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/export-graph.ts")} --out ${path.join(repoRoot(), "tools/buck/graph.json")}`}`;
  }

  // Materialize Nix-built graph BEFORE Buck build to ensure attribute exists
  if (!isCI && materialize) {
    const linkDir = path.resolve(repoRoot(), "buck-out", "tmp");
    await fsp.mkdir(linkDir, { recursive: true });
    const linkName = path.join(linkDir, `buck-go-${Date.now()}`);
    try {
      // Ensure Nix sees the live graph.json via BUCK_GRAPH_JSON; fallback is flake literal
      const absGraph = path.resolve(repoRoot(), "tools/buck/graph.json");
      // Provide a repo-root gomod2nix.toml fallback via ROOT_GOMOD2NIX_TOML when missing
      let rootToml = path.resolve("gomod2nix.toml");
      try {
        const stat = await fsp.stat(rootToml).catch(() => null);
        if (!stat) {
          // Scan for a module-level gomod2nix.toml under apps/ or libs/
          const roots = [path.resolve("apps"), path.resolve("libs")];
          let found = "";
          for (const r of roots) {
            try {
              const ents = await fsp.readdir(r, { withFileTypes: true });
              for (const e of ents) {
                if (!e.isDirectory()) continue;
                const p = path.join(r, e.name, "gomod2nix.toml");
                try {
                  const st = await fsp.stat(p);
                  if (st && st.isFile()) {
                    found = p;
                    break;
                  }
                } catch {}
              }
            } catch {}
            if (found) break;
          }
          if (found) rootToml = found;
        }
      } catch {}
      const env = {
        ...process.env,
        BUCK_GRAPH_JSON: absGraph,
        ROOT_GOMOD2NIX_TOML: rootToml,
        BUCK_TEST_SRC: process.cwd(),
      };
      await $({
        stdio: "inherit",
        env,
        cwd: repoRoot(),
      })`nix build --impure .#graph-generator --out-link ${linkName}`;
      // Print discovered bins for convenience (match requested labels if provided)
      try {
        const manifestPath = path.resolve(linkName, "manifest.json");
        const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
        const targets = restArgs.length ? restArgs : [];
        if (txt) {
          const entries = JSON.parse(txt) as Array<any>;
          const specific = targets.filter(
            (t) => (t.includes(":") || t.startsWith("//")) && !t.includes("..."),
          );
          const match = (lab: string) => {
            if (specific.length === 0) return true;
            return specific.some((t) => {
              const norm = t.replace(/^root\//, "").replace(/^\/+/, "");
              return lab.includes(norm) || lab.endsWith(norm);
            });
          };
          const bins: Array<{ label: string; bin: string }> = [];
          for (const e of entries) {
            const lab = String(e?.label || "");
            if (!lab || !match(lab)) continue;
            const list: string[] = Array.isArray(e?.bins) ? e.bins : [];
            for (const b of list) bins.push({ label: lab, bin: String(b) });
          }
          if (bins.length) {
            console.log("Materialized binaries:");
            for (const b of bins) console.log(` - ${b.label}: ${b.bin}`);
          } else {
            console.log(
              "Materialized graph; no binaries matched the requested labels. See",
              path.join(linkName, "manifest.json"),
            );
          }
        }
      } catch {}
    } finally {
    }
  }

  // Now run Buck
  async function findBuckBin(): Promise<string> {
    return "buck2";
  }
  const buckBin = await findBuckBin();
  const platformFlags = ["--target-platforms", "prelude//platforms:default"];
  process.env.BUCK_ROOT = repoRoot();
  const proc = await $({
    stdio: "inherit",
    cwd: repoRoot(),
  })`${buckBin} ${subcmd} ${platformFlags} ${restArgs}`.catch((e) => e);
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) process.exit(code);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
