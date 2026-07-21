#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { printSkip } from "../../lib/errors";
import { createCommandUi } from "../../lib/command-ui";
import { writeIfChanged } from "../../lib/fs-helpers";
import { nodeFlagsWithZx, runNodeWithZx } from "../../lib/node-run";
import { findRepoRoot } from "../../lib/repo";
import {
  generatedGlobalInputMarker,
  readGlobalNixInputTargets,
} from "../../lib/global-nix-input-targets";
import { ensureWorkspaceProvidersPackage } from "../../lib/workspace-providers-package";
import { DEFAULT_AUTO_MAP_PATH } from "../../lib/workspace-state-paths";
import { buildToolPath, zxInitPath } from "../dev-build/paths";
import { globalNixInputFingerprint } from "../global-nix-input-fingerprint";
import { handoffChangedGlobalInputConsumers } from "../buck-global-input-handoff";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
import { discoverImportersWithLock } from "./importers";
import { glueFingerprintFresh, writeGlueFingerprint } from "./glue-freshness";

function outputTail(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const max = 12_000;
  return text.length > max ? text.slice(text.length - max) : text;
}

function printGlueFailure(label: string, result: unknown): void {
  const proc = result as {
    stdout?: unknown;
    stderr?: unknown;
    cause?: { stdout?: unknown; stderr?: unknown };
  };
  const details = [proc.stderr, proc.stdout, proc.cause?.stderr, proc.cause?.stdout]
    .map(outputTail)
    .filter(Boolean)
    .join("\n");
  process.stderr.write(`[install-deps] glue step failed: ${label}\n`);
  if (details) process.stderr.write(`${details}\n`);
}

function repoRoot(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..", "..");
}

async function workspaceRoot(): Promise<string> {
  const cwd = process.cwd();
  const wr = String(process.env.WORKSPACE_ROOT || "").trim();
  if (wr) {
    try {
      const abs = path.resolve(wr);
      if (cwd === abs || cwd.startsWith(abs + path.sep)) return abs;
    } catch {}
  }
  return await findRepoRoot(cwd);
}

export function zxNodeBase(root: string): string {
  const zxInit = zxInitPath(root);
  return nodeFlagsWithZx(zxInit).join(" ");
}

async function ensurePreludeSymlinkIfMissing() {
  const wsRoot = await workspaceRoot();
  await applyNixCacheHealthPolicy(wsRoot);
  for (const preludePath of [
    path.join(wsRoot, ".viberoots", "workspace", "prelude"),
    path.join(wsRoot, ".viberoots", "current", "prelude"),
  ]) {
    try {
      await fsp.access(preludePath);
      return;
    } catch {}
  }
  throw new Error("[glue] missing .viberoots/workspace/prelude; run workspace activation first");
}

async function ensureAutoMapStubIfMissing() {
  const wsRoot = await workspaceRoot();
  await ensureWorkspaceProvidersPackage(wsRoot);
  const outPath = path.join(wsRoot, DEFAULT_AUTO_MAP_PATH);
  try {
    await fsp.access(outPath);
    return;
  } catch {}
  await writeIfChanged(
    outPath,
    [
      "# @workspace_providers//:auto_map.bzl",
      "# GENERATED FILE — DO NOT EDIT.",
      "",
      "MODULE_PROVIDERS = {",
      "",
      "}",
      "",
    ].join("\n"),
  );
}

async function ensureWorkspaceGlobalNixInputTargets(reconcile: boolean) {
  const wsRoot = await workspaceRoot();
  const workspaceDir = path.join(wsRoot, ".viberoots", "workspace");
  const extensionPath = path.join(workspaceDir, "nixpkgs-source-registry-extension.nix");
  if (reconcile && !(await fsp.stat(extensionPath).catch(() => null))) {
    await writeIfChanged(extensionPath, "{ inputs }: { profiles = { }; }\n");
  }
  const rendered = await readGlobalNixInputTargets(wsRoot).catch((error) => {
    throw new Error(`[glue] global Nix input authority is incomplete\nrepair: run u`, {
      cause: error,
    });
  });
  const expected = [
    ["projects/config/TARGETS", rendered.projectsConfigTargets],
    [".viberoots/workspace/TARGETS", rendered.workspaceTargets],
  ] as const;
  for (const [relative, contents] of expected) {
    const file = path.join(wsRoot, relative);
    const current = await fsp.readFile(file, "utf8").catch(() => "");
    if (current === contents) continue;
    if (
      relative === "projects/config/TARGETS" &&
      current &&
      !current.includes(generatedGlobalInputMarker)
    ) {
      throw new Error(`[glue] ${relative} is owned by viberoots and contains custom rules`);
    }
    if (!reconcile) throw new Error(`[glue] stale ${relative}\nrepair: run u`);
    await writeIfChanged(file, contents);
  }
  const oldTargets = path.join(wsRoot, "projects/TARGETS");
  const oldContents = await fsp.readFile(oldTargets, "utf8").catch(() => "");
  if (oldContents.includes(generatedGlobalInputMarker)) {
    if (!reconcile) throw new Error("[glue] stale generated projects/TARGETS\nrepair: run u");
    await fsp.rm(oldTargets, { force: true });
  }
  if (reconcile) {
    await fsp.rm(path.join(workspaceDir, "node-modules.hashes.json"), { force: true });
    await fsp.rm(path.join(wsRoot, "projects/node-modules.hashes.json"), { force: true });
  }
}

export async function runGlue(dryRun: boolean, verbose: boolean, priorGlobalInputs = "") {
  const ui = createCommandUi({ verbose });
  const nodeBin = process.execPath || "node";
  const wsRoot = await workspaceRoot();
  const nodeBase = zxNodeBase(wsRoot);
  const reconcileGlobalInputs = priorGlobalInputs !== "";
  await ensureWorkspaceGlobalNixInputTargets(reconcileGlobalInputs);
  const globalInputsBeforePipeline = await globalNixInputFingerprint(wsRoot);
  if (priorGlobalInputs !== "" && globalInputsBeforePipeline !== priorGlobalInputs) {
    await handoffChangedGlobalInputConsumers(wsRoot);
  }
  const zxImport = zxInitPath(wsRoot);
  type LangConfig = {
    enabled?: string[];
    languages?: Array<{ id: string; capabilities?: Record<string, boolean> }>;
  };
  let enabledLangs: Set<string> = new Set();
  const caps = new Map<string, Record<string, boolean>>();
  const langsJson = buildToolPath(wsRoot, "tools/nix/langs.json");
  try {
    const cfg = JSON.parse(await fsp.readFile(langsJson, "utf8")) as LangConfig;
    for (const l of cfg.enabled || []) enabledLangs.add(l);
    for (const l of cfg.languages || [])
      caps.set(String(l.id), (l.capabilities || {}) as Record<string, boolean>);
  } catch {}
  if (enabledLangs.size === 0) {
    const tplDir = buildToolPath(wsRoot, "tools/nix/templates");
    try {
      const entries = await fsp.readdir(tplDir);
      for (const n of entries) {
        const base = n.trim().replace(/\.nix$/, "");
        if (base) enabledLangs.add(base);
      }
    } catch {}
  }
  const haveGo = enabledLangs.has("go");
  const haveNode = enabledLangs.has("node");
  const haveCpp = enabledLangs.has("cpp");
  const goCaps = caps.get("go") || {};
  const nodeCaps = caps.get("node") || {};

  const skipPnpmHash =
    String(process.env.INSTALL_GLUE_SKIP_PNPM_HASH || "").trim() === "1" ||
    String(process.env.INSTALL_DEPS_GLUE_ONLY || "").trim() === "1";
  // If Node is enabled, reconcile pnpm fixed-output hashes for any discovered importers.
  if (haveNode && !skipPnpmHash) {
    try {
      const repo = wsRoot;
      const importers = await discoverImportersWithLock(repo, { cwd: process.cwd() });
      if (importers.length) {
        const updater = buildToolPath(repo, "tools/dev/update-pnpm-hash.ts");
        for (const imp of importers) {
          const relLock = path.join(imp, "pnpm-lock.yaml");
          if (dryRun) {
            console.log(`[dry-run] ${nodeBin} ${nodeBase} ${updater} --lockfile ${relLock}`);
          } else {
            if (verbose) console.log(`[run] ${updater} --lockfile ${relLock}`);
            await runNodeWithZx({
              nodeBin,
              zxInitPath: zxImport,
              script: updater,
              args: ["--lockfile", relLock],
              cwd: repo,
              stdio: verbose ? "inherit" : "pipe",
              env: {
                ...process.env,
                INSTALL_LOCK_SKIP: "1",
                WORKSPACE_ROOT: wsRoot,
                BUCK_TEST_SRC: wsRoot,
              },
            });
          }
        }
      }
    } catch {}
  }

  const cmds: Array<{
    label: string;
    script: string;
    args?: string[];
    when?: boolean;
    skipReason?: string;
  }> = [
    {
      label: "gen-importer-roots",
      script: buildToolPath(wsRoot, "tools/dev/gen-importer-roots-bzl.ts"),
      when: true,
    },
    {
      label: "gen-langs",
      script: buildToolPath(wsRoot, "tools/dev/gen-langs.ts"),
      when: true,
    },
    {
      label: "gen-nix-attr-aliases",
      script: buildToolPath(wsRoot, "tools/dev/gen-nix-attr-aliases-bzl.ts"),
      when: true,
    },
    {
      label: "glue-pipeline",
      script: buildToolPath(wsRoot, "tools/buck/glue-pipeline.ts"),
      args: ["--run-pipeline", "--force-graph", "--defer-fingerprint"],
      when: true,
    },
  ];
  await ensureAutoMapStubIfMissing();
  await ensurePreludeSymlinkIfMissing();
  if (!dryRun) {
    const freshness = await glueFingerprintFresh(wsRoot);
    if (freshness.fresh) {
      const globalInputsAfter = await globalNixInputFingerprint(wsRoot);
      if (priorGlobalInputs !== "" && globalInputsAfter !== priorGlobalInputs) {
        await handoffChangedGlobalInputConsumers(wsRoot);
      }
      if (verbose) console.log("[install-deps] glue already fresh; skipping");
      else ui.ok("glue", "already fresh");
      return;
    }
    if (verbose) {
      console.log(`[install-deps] glue refresh required (${freshness.reason})`);
    } else {
      ui.step("glue", "refreshing");
    }
  }
  const graphPath = path.join(wsRoot, ".viberoots", "workspace", "buck", "graph.json");
  const graphBefore = dryRun ? "" : await fsp.readFile(graphPath, "utf8").catch(() => "");
  for (const c of cmds) {
    if (c.when === false) {
      if (c.skipReason) {
        printSkip(c.skipReason as any, c.label);
      }
      continue;
    }
    if (dryRun) {
      console.log(
        `[dry-run] ${nodeBin} ${nodeBase} ${c.script} ${(c.args || []).join(" ")}`.trim(),
      );
      continue;
    }
    if (verbose) console.log(`[run] ${c.script} ${(c.args || []).join(" ")}`.trim());
    const env: Record<string, string> = {
      ...process.env,
      WORKSPACE_ROOT: wsRoot,
      BUCK_TEST_SRC: wsRoot,
    };
    try {
      await runNodeWithZx({
        nodeBin,
        zxInitPath: zxImport,
        script: c.script,
        args: c.args || [],
        cwd: wsRoot,
        env,
        stdio: verbose ? "inherit" : "pipe",
      });
    } catch (error) {
      printGlueFailure(c.label, error);
      const exitCode =
        typeof (error as { exitCode?: unknown }).exitCode === "number"
          ? (error as { exitCode: number }).exitCode || 1
          : 1;
      process.exit(exitCode);
    }
  }
  if (!dryRun) {
    const graphAfter = await fsp.readFile(graphPath, "utf8").catch(() => "");
    const globalInputsAfter = await globalNixInputFingerprint(wsRoot);
    if (
      graphAfter !== graphBefore ||
      (priorGlobalInputs !== "" && globalInputsAfter !== priorGlobalInputs)
    ) {
      await handoffChangedGlobalInputConsumers(wsRoot);
    }
    await writeGlueFingerprint(wsRoot);
  }
}
