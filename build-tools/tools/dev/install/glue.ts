#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { printSkip } from "../../lib/errors";
import { nodeFlagsWithZx } from "../../lib/node-run";
import { findRepoRoot } from "../../lib/repo";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
import { discoverImportersWithLock } from "./importers";

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

export function zxNodeBase(): string {
  const zxInit = path.resolve(repoRoot(), "build-tools/tools/dev/zx-init.mjs");
  return nodeFlagsWithZx(zxInit).join(" ");
}

async function ensurePreludeSymlinkIfMissing() {
  const wsRoot = await workspaceRoot();
  await applyNixCacheHealthPolicy(wsRoot);
  try {
    const check = await $({
      stdio: "pipe",
      cwd: wsRoot,
    })`bash --noprofile --norc -c ${`test -e ${path.join(wsRoot, "prelude")}`}`;
    if (check.exitCode === 0) return;
  } catch {}
  const zxInit = String(process.env.ZX_INIT || "").trim();
  const flakeRoot =
    zxInit && zxInit.length > 0 ? path.resolve(path.dirname(zxInit), "..", "..") : repoRoot();
  const build = await $({
    stdio: "pipe",
    cwd: flakeRoot,
  })`nix build ${flakeRoot}#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
  const storeOut = String(build.stdout || "")
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!storeOut) {
    throw new Error("[glue] Failed to resolve buck2-prelude store path");
  }
  const src = path.join(storeOut, "prelude");
  const dst = path.join(wsRoot, "prelude");
  await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(src, dst, "dir");
}

async function ensureAutoMapStubIfMissing() {
  const wsRoot = await workspaceRoot();
  const outPath = path.join(wsRoot, "third_party", "providers", "auto_map.bzl");
  try {
    await fsp.access(outPath);
    return;
  } catch {}
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(
    outPath,
    [
      "# //third_party/providers/auto_map.bzl",
      "# GENERATED FILE — DO NOT EDIT.",
      "",
      "MODULE_PROVIDERS = {",
      "",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function runGlue(dryRun: boolean, verbose: boolean) {
  const nodeBase = zxNodeBase();
  const nodeBin = process.execPath || "node";
  const zxImport = path.join(repoRoot(), "build-tools/tools/dev/zx-init.mjs");
  const wsRoot = await workspaceRoot();
  type LangConfig = {
    enabled?: string[];
    languages?: Array<{ id: string; capabilities?: Record<string, boolean> }>;
  };
  let enabledLangs: Set<string> = new Set();
  const caps = new Map<string, Record<string, boolean>>();
  const langsJson = path.join(repoRoot(), "build-tools/tools/nix/langs.json");
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
    const tplDir = path.join(repoRoot(), "build-tools/tools/nix/templates");
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
        const updater = path.join(repo, "build-tools/tools/dev/update-pnpm-hash.ts");
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
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "build-tools/tools/dev/gen-importer-roots-bzl.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "gen-langs",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "build-tools/tools/dev/gen-langs.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "gen-nix-attr-aliases",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "build-tools/tools/dev/gen-nix-attr-aliases-bzl.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "glue-pipeline",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "build-tools/tools/buck/glue-pipeline.ts")}`,
      withZx: true,
      when: true,
    },
  ];
  await ensureAutoMapStubIfMissing();
  await ensurePreludeSymlinkIfMissing();
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
          NODE_OPTIONS: [`--import ${zxImport}`, process.env.NODE_OPTIONS || ""]
            .filter(Boolean)
            .join(" "),
        }
      : baseEnv;
    await $({ stdio: "inherit", cwd: wsRoot, env })`bash --noprofile --norc -c ${c.cmd}`;
  }
}
