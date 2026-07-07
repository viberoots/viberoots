#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { printSkip } from "../../lib/errors";
import { createCommandUi } from "../../lib/command-ui";
import { writeIfChanged } from "../../lib/fs-helpers";
import { nodeFlagsWithZx, nodeOptionsWithoutZxInit } from "../../lib/node-run";
import { findRepoRoot } from "../../lib/repo";
import { ensureWorkspaceProvidersPackage } from "../../lib/workspace-providers-package";
import { DEFAULT_AUTO_MAP_PATH } from "../../lib/workspace-state-paths";
import { buildToolPath, zxInitPath } from "../dev-build/paths";
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
  try {
    await fsp.access(path.join(wsRoot, ".viberoots", "current", "prelude"));
    return;
  } catch {}
  throw new Error("[glue] missing .viberoots/current/prelude; run workspace activation first");
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

async function ensureWorkspaceGlobalNixInputTargets() {
  const wsRoot = await workspaceRoot();
  const workspaceDir = path.join(wsRoot, ".viberoots", "workspace");
  await fsp.mkdir(workspaceDir, { recursive: true });
  const extensionPath = path.join(workspaceDir, "nixpkgs-source-registry-extension.nix");
  try {
    await fsp.access(extensionPath);
  } catch {
    await writeIfChanged(extensionPath, "{ inputs }: { profiles = { }; }\n");
  }
  await writeIfChanged(
    path.join(workspaceDir, "TARGETS"),
    [
      "filegroup(",
      '    name = "flake.lock",',
      '    srcs = ["flake.lock"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "filegroup(",
      '    name = "nixpkgs-source-registry-extension",',
      '    srcs = ["nixpkgs-source-registry-extension.nix"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
}

export async function runGlue(dryRun: boolean, verbose: boolean) {
  const ui = createCommandUi({ verbose });
  const nodeBin = process.execPath || "node";
  const wsRoot = await workspaceRoot();
  const nodeBase = zxNodeBase(wsRoot);
  await ensureWorkspaceGlobalNixInputTargets();
  const zxImport = zxInitPath(wsRoot);
  type LangConfig = {
    enabled?: string[];
    languages?: Array<{ id: string; capabilities?: Record<string, boolean> }>;
  };
  let enabledLangs: Set<string> = new Set();
  const caps = new Map<string, Record<string, boolean>>();
  const langsJson = buildToolPath(wsRoot, "tools/nix/langs.json");
  try {
    const { stdout } = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c ${`test -f ${langsJson} && cat ${langsJson}`}`;
    const cfg = JSON.parse(String(stdout || "{}")) as LangConfig;
    for (const l of cfg.enabled || []) enabledLangs.add(l);
    for (const l of cfg.languages || [])
      caps.set(String(l.id), (l.capabilities || {}) as Record<string, boolean>);
  } catch {}
  if (enabledLangs.size === 0) {
    const tplDir = buildToolPath(wsRoot, "tools/nix/templates");
    try {
      const { stdout } = await $({
        stdio: "pipe",
      })`bash --noprofile --norc -c ${`test -d ${tplDir} && ls -1 ${tplDir}`}`;
      for (const n of String(stdout || "").split(/\r?\n/)) {
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
    cmd: string;
    withZx?: boolean;
    when?: boolean;
    skipReason?: string;
  }> = [
    {
      label: "gen-importer-roots",
      cmd: `${nodeBin} ${nodeBase} ${buildToolPath(wsRoot, "tools/dev/gen-importer-roots-bzl.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "gen-langs",
      cmd: `${nodeBin} ${nodeBase} ${buildToolPath(wsRoot, "tools/dev/gen-langs.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "gen-nix-attr-aliases",
      cmd: `${nodeBin} ${nodeBase} ${buildToolPath(wsRoot, "tools/dev/gen-nix-attr-aliases-bzl.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "glue-pipeline",
      cmd: `${nodeBin} ${nodeBase} ${buildToolPath(wsRoot, "tools/buck/glue-pipeline.ts")}`,
      withZx: true,
      when: true,
    },
  ];
  await ensureAutoMapStubIfMissing();
  await ensurePreludeSymlinkIfMissing();
  if (!dryRun) {
    const freshness = await glueFingerprintFresh(wsRoot);
    if (freshness.fresh) {
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
  for (const c of cmds) {
    if (c.when === false) {
      if (c.skipReason) {
        printSkip(c.skipReason as any, c.label);
      }
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${c.cmd}`);
      continue;
    }
    if (verbose) console.log(`[run] ${c.cmd}`);
    const baseEnv: Record<string, string> = {
      ...process.env,
      WORKSPACE_ROOT: wsRoot,
      BUCK_TEST_SRC: wsRoot,
    };
    const env = c.withZx
      ? {
          ...baseEnv,
          NODE_OPTIONS: [`--import ${zxImport}`, nodeOptionsWithoutZxInit(process.env.NODE_OPTIONS)]
            .filter(Boolean)
            .join(" "),
        }
      : baseEnv;
    const child = $({
      stdio: verbose ? "inherit" : "pipe",
      cwd: wsRoot,
      env,
      reject: false,
    })`bash --noprofile --norc -c ${c.cmd}`;
    const res = verbose ? await child : await child.quiet();
    if (res.exitCode !== 0) {
      printGlueFailure(c.label, res);
      process.exit(res.exitCode || 1);
    }
  }
  if (!dryRun) {
    await writeGlueFingerprint(wsRoot);
  }
}
