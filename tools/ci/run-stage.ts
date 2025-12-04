#!/usr/bin/env zx-wrapper
// tools/ci/run-stage.ts — small runner to invoke named CI stages locally or in CI
import * as fsp from "node:fs/promises";
import assert from "node:assert";
import path from "node:path";
import { ensureGraph, runGlue } from "../buck/glue-run.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { getFlagStr } from "../lib/cli.ts";

type Stage =
  | "codegen"
  | "glue"
  | "export-graph"
  | "sync-providers"
  | "gen-auto-map"
  | "prebuild-guard"
  | "patches-lint"
  | "file-size-lint"
  | "nix-build-graph-generator"
  | "buck-test"
  | "cpp-addon-smoke"
  | "wheelhouse-preload";

const stage = getFlagStr("stage", "");
assert(stage, "missing --stage=<name>");
const zxInit = path.resolve("tools/dev/zx-init.mjs");
const nodeBase = [
  "--experimental-top-level-await",
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--import",
  zxInit,
];

async function main() {
  // Load capability/enablement manifest (best-effort; skip if missing)
  type LangCfg = { id: string; capabilities?: Record<string, boolean> };
  type Manifest = { enabled?: string[]; languages?: LangCfg[] } | LangCfg[];
  function normalize(raw: any): {
    enabled: Set<string>;
    caps: Map<string, Record<string, boolean>>;
  } {
    const enabled = new Set<string>();
    const caps = new Map<string, Record<string, boolean>>();
    if (Array.isArray(raw)) {
      for (const l of raw as any[]) caps.set(String(l.id), (l.capabilities || {}) as any);
    } else if (raw && Array.isArray(raw.languages)) {
      for (const l of raw.languages as any[]) caps.set(String(l.id), (l.capabilities || {}) as any);
      for (const e of raw.enabled || []) enabled.add(String(e));
    }
    return { enabled, caps };
  }
  let enabled = new Set<string>();
  let caps = new Map<string, Record<string, boolean>>();
  try {
    const txt = await fsp.readFile(path.resolve("tools/nix/langs.json"), "utf8");
    const norm = normalize(JSON.parse(txt) as Manifest);
    enabled = norm.enabled;
    caps = norm.caps;
  } catch {}

  switch (stage as Stage) {
    case "codegen": {
      const target = path.resolve("tools/codegen.ts");
      try {
        await $`test -f ${target} || exit 0`;
        await $`node ${nodeBase} ${target}`;
      } catch {}
      break;
    }
    case "langs-validate": {
      const target = path.resolve("tools/dev/validate-langs.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "export-graph": {
      await ensureGraph();
      break;
    }
    case "glue": {
      await runGlue();
      break;
    }
    case "sync-providers": {
      // Unified orchestrator: always run for enabled languages; drivers are no-ops if inactive
      const target = path.resolve("tools/buck/sync-providers.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "gen-auto-map": {
      // Generate only if any enabled language has patching or lockfileLabels capability
      if (enabled.size) {
        let any = false;
        for (const id of enabled) {
          const c = caps.get(id) || {};
          if (c.patching || c.lockfileLabels) {
            any = true;
            break;
          }
        }
        if (!any) break;
      }
      const target = path.resolve("tools/buck/gen-auto-map.ts");
      await $`node ${nodeBase} ${target} --graph ${DEFAULT_GRAPH_PATH} --out third_party/providers/auto_map.bzl`;
      break;
    }
    case "prebuild-guard": {
      const target = path.resolve("tools/buck/prebuild-guard.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "patches-lint": {
      const target = path.resolve("tools/dev/patches-lint.ts");
      // Strict mode in CI; run for Go and Python (importer-local) to enforce parity
      await $`node ${nodeBase} ${target} --strict --lang go`;
      await $`node ${nodeBase} ${target} --strict --lang python`;
      break;
    }
    case "file-size-lint": {
      const target = path.resolve("tools/dev/file-size-lint.ts");
      const failFlag = process.env.CI === "true" ? "--fail=true" : "";
      await $`node ${nodeBase} ${target} --changed-only ${failFlag}`;
      break;
    }
    case "nix-build-graph-generator":
      // Optional: if the flake doesn't expose graph-generator, skip gracefully in local runs
      try {
        await $`nix build .#graph-generator`;
      } catch (e) {
        console.warn("graph-generator attribute missing; skipping nix build stage");
      }
      break;
    case "buck-test":
      // External timeout is recommended; allow override via TIMEOUT_SEC
      const t = Number(process.env.TIMEOUT_SEC || 1200);
      // Coverage passthrough if COVERAGE=1 in env
      const extra = process.env.COVERAGE === "1" ? ["--", "--env", "COVERAGE=1"] : [];
      await $`timeout -k 10s ${t}s buck2 test //... ${extra}`;
      break;
    case "cpp-addon-smoke": {
      const target = path.resolve("tools/ci/cpp-addon-smoke.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "wheelhouse-preload": {
      // Discover py-wheelhouse-* attributes for the current system, build them, and optionally push to a binary cache.
      // Destination can be provided via --to or NIX_CACHE_TO env.
      const to = getFlagStr("to", process.env.NIX_CACHE_TO || "");
      // Discover current system as recognized by Nix
      const sysOut = await $`nix eval --raw --impure --expr builtins.currentSystem`.nothrow();
      const system = String(sysOut.stdout || "").trim();
      if (!system) {
        console.warn("wheelhouse-preload: could not determine current system; skipping");
        break;
      }
      // Enumerate package attributes for this system and pick py-wheelhouse-* keys
      const evalOut =
        await $`nix eval --json --impure --accept-flake-config .#packages.${system}`.nothrow();
      if (evalOut.exitCode !== 0) {
        console.warn("wheelhouse-preload: packages set not available for system; skipping");
        break;
      }
      let keys: string[] = [];
      try {
        const obj = JSON.parse(String(evalOut.stdout || "{}"));
        keys = Object.keys(obj || {}).filter((k) => k.startsWith("py-wheelhouse-"));
      } catch {
        // best-effort parse; treat as empty
        keys = [];
      }
      if (!keys.length) {
        console.log("wheelhouse-preload: no wheelhouse outputs found; nothing to do");
        break;
      }
      // Build all wheelhouse outputs for this system
      const attrs = keys.map((k) => `.#${k}`).join(" ");
      await $`bash -lc ${`set -euo pipefail; nix build --impure --accept-flake-config ${attrs}`}`;
      // Optionally push to a binary cache if configured
      if (to && to.trim() !== "") {
        const pathsOut = await $`bash -lc ${`set -euo pipefail; nix path-info ${attrs}`}`;
        const paths = String(pathsOut.stdout || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .join(" ");
        if (paths.length > 0) {
          await $`bash -lc ${`set -euo pipefail; nix copy --to '${to}' ${paths}`}`;
          console.log(`wheelhouse-preload: pushed ${keys.length} outputs to ${to}`);
        }
      } else {
        console.log("wheelhouse-preload: cache destination not provided; built locally only");
      }
      break;
    }
    default:
      throw new Error(`unknown stage: ${stage}`);
  }
  // Post-stage housekeeping: best-effort cleanup of ephemeral temp outs
  try {
    await $`node ${nodeBase} tools/dev/clean-temp-outs.ts`.nothrow();
  } catch {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
