#!/usr/bin/env zx-wrapper
// build-tools/tools/ci/run-stage.ts — small runner to invoke named CI stages locally or in CI
import assert from "node:assert";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureGraph, runGlue } from "../buck/glue-run";
import { getFlagStr } from "../lib/cli";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { DEFAULT_AUTO_MAP_PATH } from "../lib/workspace-state-paths";
import { runNodeWithZx } from "../lib/node-run";
import { buildToolPath, buildToolsRoot } from "../dev/dev-build/paths";
import { runCiBuckTestStage } from "./buck-test-stage";
import { runWheelhousePreload } from "./wheelhouse-preload";
import { classifyArtifactBuild } from "../lib/artifact-build-policy";
import {
  admitArtifactContext,
  inspectWorkspaceArtifactSource,
} from "../dev/artifact-policy-inspection";

type Stage =
  | "codegen"
  | "langs-validate"
  | "glue"
  | "export-graph"
  | "sync-providers"
  | "gen-auto-map"
  | "nix-gaps-policy"
  | "prebuild-guard"
  | "patches-lint"
  | "file-size-lint"
  | "nix-build-graph-generator"
  | "buck-test"
  | "cpp-addon-smoke"
  | "wheelhouse-preload";

const stage = getFlagStr("stage", "");
assert(stage, "missing --stage=<name>");
const workspaceRoot = process.cwd();
const viberootsBuildToolsRoot = buildToolsRoot(workspaceRoot);
const viberootsRoot = path.resolve(viberootsBuildToolsRoot, "..");
const zxInit = buildToolPath(workspaceRoot, "tools/dev/zx-init.mjs");

function toolPath(rel: string): string {
  return buildToolPath(workspaceRoot, rel);
}

function viberootsPath(rel: string): string {
  return path.join(viberootsRoot, rel);
}

async function runTool(script: string, args: string[] = []) {
  await runNodeWithZx({ zxInitPath: zxInit, script, args });
}

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
    const txt = await fsp.readFile(toolPath("tools/nix/langs.json"), "utf8");
    const norm = normalize(JSON.parse(txt) as Manifest);
    enabled = norm.enabled;
    caps = norm.caps;
  } catch {}

  switch (stage as Stage) {
    case "codegen": {
      const target = toolPath("tools/codegen.ts");
      try {
        await $`test -f ${target} || exit 0`;
        await runTool(target);
      } catch {}
      break;
    }
    case "langs-validate": {
      const target = toolPath("tools/dev/validate-langs.ts");
      await runTool(target);
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
      const target = toolPath("tools/buck/sync-providers.ts");
      await runTool(target);
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
      const target = toolPath("tools/buck/gen-auto-map.ts");
      await runTool(target, ["--graph", DEFAULT_GRAPH_PATH, "--out", DEFAULT_AUTO_MAP_PATH]);
      break;
    }
    case "nix-gaps-policy": {
      const target = toolPath("tools/dev/nix-gaps-inventory-check.ts");
      await runTool(target, [
        "--starlark-api",
        viberootsPath("docs/handbook/starlark-api.md"),
        "--nix-gaps",
        viberootsPath("docs/handbook/nix-gaps.md"),
        "--exceptions",
        viberootsPath("docs/handbook/nix-gaps-exceptions.json"),
      ]);
      break;
    }
    case "prebuild-guard": {
      const target = toolPath("tools/buck/prebuild-guard.ts");
      await runTool(target);
      await runTool(toolPath("tools/scaffolding/gen-template-manifest-artifacts.ts"), ["--check"]);
      break;
    }
    case "patches-lint": {
      const target = toolPath("tools/dev/patches-lint.ts");
      // Strict mode in CI; run for Go and Python (importer-local) to enforce parity
      await runTool(target, ["--strict", "--lang", "go"]);
      await runTool(target, ["--strict", "--lang", "python"]);
      break;
    }
    case "file-size-lint": {
      const target = toolPath("tools/dev/file-size-lint.ts");
      await runTool(target, ["--scope=source", "--fail=true"]);
      break;
    }
    case "nix-build-graph-generator": {
      // Optional: if the flake doesn't expose graph-generator, skip gracefully in local runs
      const source = await inspectWorkspaceArtifactSource({
        workspaceRoot,
        targetPackages: [],
      });
      await admitArtifactContext({
        classification: classifyArtifactBuild({
          diagnosticImpure: false,
          localDevelopment: source.localDevelopment,
        }),
        purpose: "ci",
        impureEvaluation: false,
        workspaceRoot,
        toolNames: ["git"],
      });
      try {
        await $`nix build .#graph-generator --no-link`;
      } catch (e) {
        console.warn("graph-generator attribute missing; skipping nix build stage");
      }
      break;
    }
    case "buck-test":
      await runCiBuckTestStage();
      break;
    case "cpp-addon-smoke": {
      const target = toolPath("tools/ci/cpp-addon-smoke.ts");
      await runTool(target);
      break;
    }
    case "wheelhouse-preload": {
      await runWheelhousePreload();
      break;
    }
    default:
      throw new Error(`unknown stage: ${stage}`);
  }
  // Post-stage housekeeping: best-effort cleanup of ephemeral temp outs
  try {
    await runTool(toolPath("tools/dev/clean-temp-outs.ts"));
  } catch {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
