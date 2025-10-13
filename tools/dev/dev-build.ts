#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./install/gomod2nix.ts";

function shouldInstallDeps(materialize: boolean): boolean {
  // Only install or refresh glue when materializing; otherwise avoid mutating the workspace
  return materialize;
}

function repoRoot(): string {
  // Prefer the current working directory so tests running in a temp repo
  // operate on that sandbox rather than the original workspace.
  // Fall back to script-relative resolution if CWD is unavailable.
  try {
    return process.cwd();
  } catch {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, "..", "..");
  }
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
    await $({ cwd: repoRoot() })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
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
    await $({ cwd: repoRoot() })`bash --noprofile --norc -c ${`set -euo pipefail
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
  // Prepare a scoped Buck isolation for this process; respect an inherited isolation when provided.
  const inheritedIso = (process.env.BUCK_ISOLATION_DIR || "").trim();
  const buckIsolation = inheritedIso ? inheritedIso : `devbuild-${process.pid}`;
  const createdOwnIsolation = !inheritedIso && process.env.BUCK_NO_ISOLATION !== "1";
  const isolationFlags: string[] =
    process.env.BUCK_NO_ISOLATION === "1" ? [] : ["--isolation-dir", buckIsolation];
  async function killIsolationIfOwned() {
    if (createdOwnIsolation) {
      try {
        await $`buck2 --isolation-dir ${buckIsolation} kill`;
      } catch {}
      // Best-effort: also reap any per-test/exporter daemons left from child processes
      try {
        const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,comm=`;
        const lines = String(stdout || "").split("\n");
        for (const ln of lines) {
          const m = ln.match(/buck2d\[([^\]]+)\]/);
          if (m && /^(zxtest-|exporter-)/.test(m[1])) {
            try {
              await $`buck2 --isolation-dir ${m[1]} kill`;
            } catch {}
          }
        }
      } catch {}
    }
  }
  // Ensure we tear down the daemon if the process is interrupted or exits.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    try {
      process.on(sig as any, async () => {
        // Best-effort: terminate our entire process group so spawned tools exit promptly
        try {
          // Negative PID sends signal to the process group on POSIX systems
          process.kill(-process.pid, sig as any);
        } catch {}
        // Kill our isolation and any exporter- children we may have spawned
        try {
          await $`buck2 --isolation-dir ${buckIsolation} kill`;
        } catch {}
        try {
          const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,command=`;
          const lines = String(stdout || "").split("\n");
          for (const ln of lines) {
            const m = ln.match(/--isolation-dir\s+(exporter-[^\s]+)/);
            if (m) {
              try {
                await $`buck2 --isolation-dir ${m[1]} kill`;
              } catch {}
            }
          }
        } catch {}
        process.exit(130);
      });
    } catch {}
  }
  // Detached watchdog: if this process disappears, kill the associated buck2d isolation
  // and sweep any orphaned exporter-/zxtest-/devbuild- daemons.
  try {
    const parentPid = String(process.pid);
    const nodeBase = zxNodeBase();
    const nodeBin = process.execPath || "node";
    await $({
      stdio: "ignore",
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/dev/buck-watchdog.ts")} --parent ${parentPid} --iso ${buckIsolation} --patterns zxtest-,exporter-,devbuild- & disown`}`.nothrow();
  } catch {}
  process.once("exit", () => {
    // Fire and forget; cannot await on exit
    (async () => {
      try {
        await $`buck2 --isolation-dir ${buckIsolation} kill`;
      } catch {}
      try {
        const { stdout } = await $({ stdio: "pipe" })`/bin/ps -A -o pid=,command=`;
        const lines = String(stdout || "").split("\n");
        for (const ln of lines) {
          const m = ln.match(/--isolation-dir\s+(exporter-[^\s]+)/);
          if (m) {
            try {
              await $`buck2 --isolation-dir ${m[1]} kill`;
            } catch {}
          }
        }
      } catch {}
    })();
  });
  process.once("uncaughtException", async (err) => {
    try {
      await killIsolationIfOwned();
    } catch {}
    console.error(err);
    process.exit(1);
  });
  // Ensure process.cwd() is the repo root; repoRoot() already prefers CWD
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
  let impure = false;
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

  // Recognize opt-out flag anywhere after subcmd and --impure fast path
  const filtered: string[] = [];
  for (const a of restArgs) {
    if (a === "--no-materialize") {
      materialize = false;
      continue;
    }
    if (a === "--impure") {
      impure = true;
      continue;
    }
    filtered.push(a);
  }
  restArgs = filtered;

  // Auto-switch to impure on dev builds when there are untracked files in the working tree.
  // CI remains pure. Only applies when user didn't explicitly request pure/impure.
  if (!isCI && !impure) {
    try {
      const { stdout } = await $({
        stdio: "pipe",
        cwd: repoRoot(),
      })`git ls-files --others --exclude-standard`;
      const untracked = String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean);
      if (untracked.length > 0) {
        impure = true;
        console.warn("[dev-build] Falling back to --impure due to untracked files:");
        for (const f of untracked.slice(0, 50)) console.warn(` - ${f}`);
        if (untracked.length > 50) console.warn(` ... and ${untracked.length - 50} more`);
      }
    } catch {}
  }

  // Keep mode selection strict: impure only when explicitly requested or when
  // the working tree has untracked files (handled above). Otherwise, stay pure.

  // Allow command after flags: if first remaining arg is a known subcmd, adopt it
  if (restArgs.length > 0 && known.has(restArgs[0])) {
    subcmd = restArgs[0];
    restArgs = restArgs.slice(1);
  }

  // If no explicit targets remain (e.g., only flags like --impure were provided),
  // default to building the entire repo to avoid empty target errors.
  if (subcmd === "build" && restArgs.length === 0) {
    restArgs = ["//..."];
  }

  // Environment guard: ensure required tools and Nix features are present
  await $({ stdio: "inherit", cwd: repoRoot() })`tools/dev/startup-check.ts`;

  // Ensure Buck prelude/config only when materializing; avoid mutating workspace when --no-materialize
  if (materialize) {
    await ensureBuckPreludeConfig();
  }

  // Clean any stray buck-go-* dirs at repo root from previous runs
  await $({
    stdio: "ignore",
    cwd: repoRoot(),
  })`bash --noprofile --norc -c 'rm -rf buck-go-*'`.nothrow();

  if (!isCI && shouldInstallDeps(materialize)) {
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
    // Refresh Buck graph so graph-generator sees newest targets (only when materializing)
    await $({
      stdio: "inherit",
      cwd: repoRoot(),
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/export-graph.ts")} --out ${path.join(repoRoot(), "tools/buck/graph.json")}`}`;
    // Validate non-empty graph before pure Nix stage
    const { stdout: glen } = await $({
      stdio: "pipe",
      cwd: repoRoot(),
    })`jq -r 'length' tools/buck/graph.json`;
    const graphLen = Number(String(glen || "0").trim() || "0");
    if (!Number.isFinite(graphLen) || graphLen <= 0) {
      console.error(
        "[dev-build] ERROR: tools/buck/graph.json is empty. Export failed or found no nodes.",
      );
      process.exit(2);
    }
    // Make the graph path visible for downstream pure Nix builds
    process.env.BUCK_GRAPH_JSON = path.join(repoRoot(), "tools/buck/graph.json");
  }

  // Materialize Nix-built graph BEFORE Buck build to ensure attribute exists
  if (!isCI && materialize && !impure) {
    const linkDir = path.resolve(repoRoot(), "buck-out", "tmp");
    await fsp.mkdir(linkDir, { recursive: true });
    const linkName = path.join(linkDir, `buck-go-${Date.now()}`);
    try {
      // Pure path: build the store-pinned buck-graph from workspace graph.json
      const envPure = {
        ...process.env,
        BUCK_GRAPH_JSON: path.join(repoRoot(), "tools/buck/graph.json"),
      } as any;
      const { stdout: graphOut } = await $({
        stdio: "pipe",
        cwd: repoRoot(),
        env: envPure,
      })`nix build --impure .#buck-graph --no-link --accept-flake-config --print-out-paths`;
      const graphStore = String(graphOut || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      if (!graphStore) throw new Error("failed to build .#buck-graph");
      const targets = restArgs.length ? restArgs : [];
      // Extract only real Buck targets; ignore flags and their values (like --target-platforms <val>)
      const specific: string[] = [];
      let skipNext = false;
      for (let i = 0; i < targets.length; i++) {
        const tok = targets[i];
        if (skipNext) {
          skipNext = false;
          continue;
        }
        if (tok === "--") break;
        if (tok === "--target-platforms" || tok === "--user-platform" || tok.startsWith("-")) {
          // Skip the flag and consume its value if present (for known 2-arg flags)
          if (tok === "--target-platforms" || tok === "--user-platform") skipNext = true;
          continue;
        }
        if ((tok.startsWith("//") || tok.includes(":")) && !tok.includes("...")) specific.push(tok);
      }
      if (specific.length > 0) {
        console.log("Materializing selected targets (pure):");
        for (const sel of specific) {
          try {
            const envSel = {
              ...process.env,
              BUCK_TARGET: sel,
              BUCK_GRAPH_JSON: path.join(repoRoot(), "tools/buck/graph.json"),
            } as any;
            const { stdout: selOut } = await $({
              stdio: "pipe",
              cwd: repoRoot(),
              env: envSel,
            })`nix build .#graph-generator-pure-selected --accept-flake-config --print-out-paths`;
            const outPath =
              String(selOut || "")
                .trim()
                .split("\n")
                .filter(Boolean)
                .pop() || "";
            if (!outPath) {
              console.log(` - ${sel}: (no out path)`);
              continue;
            }
            try {
              const binDir = path.join(outPath, "bin");
              const files = await fsp.readdir(binDir).catch(() => [] as string[]);
              if (files.length) {
                for (const f of files) console.log(` - ${sel}: ${path.join(binDir, f)}`);
              } else {
                console.log(` - ${sel}: (no bin artifacts in ${binDir})`);
              }
            } catch {
              console.log(` - ${sel}: (no bin artifacts)`);
            }
          } catch (e) {
            console.log(` - ${sel}: (failed to materialize)`, e);
          }
        }
      } else {
        // Evaluate full graph outputs (pure) strictly; print a helpful warning if empty
        const envFull = {
          ...process.env,
          BUCK_GRAPH_JSON: path.join(repoRoot(), "tools/buck/graph.json"),
        } as any;
        const { stdout: pureOut } = await $({
          stdio: "pipe",
          cwd: repoRoot(),
          env: envFull,
        })`nix build --impure .#graph-generator-pure --accept-flake-config --print-out-paths`;
        const purePath =
          String(pureOut || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() || "";
        if (!purePath) {
          console.warn(
            "[dev-build] WARNING: pure graph evaluation returned no out path. If your manifest is empty, ensure buck graph export succeeded and glue exists (third_party/providers/auto_map.bzl, TARGETS.auto).",
          );
        } else {
          await $({ stdio: "inherit", cwd: repoRoot() })`ln -sfn ${purePath} ${linkName}`;
        }
        try {
          const manifestPath = path.resolve(linkName, "manifest.json");
          const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
          if (txt) {
            const entries = JSON.parse(txt) as Array<any>;
            const bins: Array<{ label: string; bin: string }> = [];
            for (const e of entries) {
              const lab = String(e?.label || "");
              if (!lab) continue;
              const list: string[] = Array.isArray(e?.bins) ? e.bins : [];
              for (const b of list) bins.push({ label: lab, bin: String(b) });
            }
            if (bins.length) {
              console.log("Materialized binaries:");
              for (const b of bins) console.log(` - ${b.label}: ${b.bin}`);
            } else {
              const labels = entries.map((e: any) => String(e?.label || "")).filter(Boolean);
              if (labels.length) {
                console.log("Materialized graph; no bins produced. Available labels:");
                for (const l of labels) console.log(` - ${l}`);
                console.log("See", path.join(linkName, "manifest.json"));
              } else {
                console.log(
                  "Materialized graph; no bins found in manifest. See",
                  path.join(linkName, "manifest.json"),
                );
              }
            }
          }
        } catch {}
      }
    } finally {
    }
  }

  // Impure fast path: ensure live graph and build selected targets via impure evaluation (CI should not use this)
  if (impure) {
    const nodeBase = zxNodeBase();
    const nodeBin = process.execPath || "node";
    await $({
      stdio: "inherit",
      cwd: repoRoot(),
    })`bash --noprofile --norc -c ${`${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/export-graph.ts")} --out ${path.join(repoRoot(), "tools/buck/graph.json")}`}`;
  }

  // Now run Buck
  async function findBuckBin(): Promise<string> {
    return "buck2";
  }
  const buckBin = await findBuckBin();
  // Always bind target platforms explicitly for reliability in sandboxes unless caller already supplied one.
  process.env.BUCK_ROOT = repoRoot();
  const hasUserPlatform =
    restArgs.includes("--target-platforms") || restArgs.includes("--user-platform");
  const platformFlags = hasUserPlatform ? [] : ["--target-platforms", "prelude//platforms:default"];
  const proc = await $({
    stdio: "inherit",
    cwd: repoRoot(),
  })`bash --noprofile --norc -c ${`${buckBin} ${isolationFlags.join(" ")} ${subcmd} ${platformFlags.join(" ")} ${restArgs.join(" ")} 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*/buckd\\.(stderr|stdout): task [0-9]+ was cancelled|buck2_event_log::writer: Failed to flush log file .*: Broken pipe \\([^)]+\\)' >&2)`}`.catch(
    (e) => e,
  );
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) process.exit(code);

  // After successful Buck build, if running in impure mode with specific targets,
  // also materialize and print impure selected Nix outputs' bin paths for convenience.
  if (impure) {
    const targets = restArgs.length ? restArgs : [];
    const specific = targets.filter(
      (t) => (t.includes(":") || t.startsWith("//")) && !t.includes("..."),
    );
    if (specific.length > 0) {
      const graphPath = path.join(repoRoot(), "tools/buck/graph.json");
      console.log("Impure selected binaries:");
      for (const sel of specific) {
        try {
          const { stdout } = await $({
            stdio: "pipe",
            cwd: repoRoot(),
            env: {
              ...process.env,
              BUCK_TEST_SRC: repoRoot(),
              BUCK_GRAPH_JSON: graphPath,
              BUCK_TARGET: sel,
            },
          })`nix build --impure .#graph-generator-selected --accept-flake-config --print-out-paths`;
          const outPath =
            String(stdout || "")
              .trim()
              .split("\n")
              .filter(Boolean)
              .pop() || "";
          if (!outPath) {
            console.log(` - ${sel}: (no out path)`);
            continue;
          }
          try {
            const binDir = path.join(outPath, "bin");
            const files = await fsp.readdir(binDir).catch(() => [] as string[]);
            if (files.length) {
              for (const f of files) console.log(` - ${sel}: ${path.join(binDir, f)}`);
            } else {
              console.log(` - ${sel}: (no bin artifacts in ${binDir})`);
            }
          } catch {
            console.log(` - ${sel}: (no bin artifacts)`);
          }
        } catch (e) {
          console.log(` - ${sel}: (failed to materialize impure selected)`, e);
        }
      }
    } else {
      // No specific targets: materialize full impure graph outputs and list any bins
      try {
        const linkDir = path.resolve(repoRoot(), "buck-out", "tmp");
        await fsp.mkdir(linkDir, { recursive: true });
        const linkNameImp = path.join(linkDir, `buck-impure-${Date.now()}`);
        const env = {
          ...process.env,
          BUCK_TEST_SRC: repoRoot(),
          BUCK_GRAPH_JSON: path.join(repoRoot(), "tools/buck/graph.json"),
        } as any;
        await $({
          stdio: "inherit",
          cwd: repoRoot(),
          env,
        })`nix build --impure .#graph-generator --accept-flake-config --out-link ${linkNameImp}`;
        const manifestPath = path.resolve(linkNameImp, "manifest.json");
        const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
        if (txt) {
          const entries = JSON.parse(txt) as Array<any>;
          const bins: Array<{ label: string; bin: string }> = [];
          for (const e of entries) {
            const lab = String(e?.label || "");
            const list: string[] = Array.isArray(e?.bins) ? e.bins : [];
            for (const b of list) bins.push({ label: lab, bin: String(b) });
          }
          if (bins.length) {
            console.log("Impure materialized binaries:");
            for (const b of bins) console.log(` - ${b.label}: ${b.bin}`);
          } else {
            const labels = entries.map((e: any) => String(e?.label || "")).filter(Boolean);
            if (labels.length) {
              console.log("Impure materialized graph; no bins produced. Available labels:");
              for (const l of labels) console.log(` - ${l}`);
              console.log("See", manifestPath);
            } else {
              console.log(
                "Impure materialized graph; no bins found in manifest. See",
                manifestPath,
              );
            }
          }
        }
      } catch {}
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
