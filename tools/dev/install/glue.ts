#!/usr/bin/env zx-wrapper
import path from "node:path";
import process from "node:process";
import * as fsp from "node:fs/promises";
import { printSkip } from "../../lib/errors.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";
import { findRepoRoot } from "../../lib/repo.ts";
import { nodeFlagsWithZx } from "../../lib/node-run.ts";

function repoRoot(): string {
  // Resolve relative to this file to avoid accidental parent cwd resolution
  const here = path.dirname(new URL(import.meta.url).pathname);
  // File lives at tools/dev/install/glue.ts → repo root is three levels up
  return path.resolve(here, "..", "..", "..");
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
  const zxInit = path.resolve(repoRoot(), "tools/dev/zx-init.mjs");
  return nodeFlagsWithZx(zxInit).join(" ");
}

async function ensurePreludeSymlinkIfMissing() {
  const wsRoot = await workspaceRoot();
  try {
    const check = await $({
      stdio: "pipe",
      cwd: wsRoot,
    })`bash --noprofile --norc -c ${`test -e ${path.join(wsRoot, "prelude")}`}`;
    if (check.exitCode === 0) return;
  } catch {}
  // Resolve the Nix-store path of the buck2 prelude and symlink it into the workspace.
  // Use the host workspace flake (derived from ZX_INIT) to avoid missing inputs in the temp copy.
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
  const zxImport = path.join(repoRoot(), "tools/dev/zx-init.mjs");
  const wsRoot = await workspaceRoot();
  // Detect enabled languages via templates or optional langs.json
  type LangConfig = {
    enabled?: string[];
    languages?: Array<{ id: string; capabilities?: Record<string, boolean> }>;
  };
  let enabledLangs: Set<string> = new Set();
  const caps = new Map<string, Record<string, boolean>>();
  const langsJson = path.join(repoRoot(), "tools/nix/langs.json");
  try {
    const { stdout } = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c ${`test -f ${langsJson} && cat ${langsJson}`}`;
    const cfg = JSON.parse(String(stdout || "{}")) as LangConfig;
    for (const l of cfg.enabled || []) enabledLangs.add(l);
    for (const l of cfg.languages || [])
      caps.set(String(l.id), (l.capabilities || {}) as Record<string, boolean>);
  } catch {}
  // Fall back to presence of templates directory entries
  if (enabledLangs.size === 0) {
    const tplDir = path.join(repoRoot(), "tools/nix/templates");
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
      // Reuse the importer roots contract (single source of truth).
      const importers: string[] = [];
      const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
      if (allowDotImporter) {
        try {
          await fsp.access(path.join(repo, "pnpm-lock.yaml"));
          importers.push(".");
        } catch {}
      }
      for (const base of workspaceRoots) {
        const baseAbs = path.join(repo, base);
        const entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
        for (const name of entries) {
          const trimmed = String(name || "").trim();
          if (!trimmed) continue;
          const impDir = path.join(repo, base, trimmed);
          const st = await fsp.stat(impDir).catch(() => null);
          if (!st || !st.isDirectory()) continue;
          const lock = path.join(impDir, "pnpm-lock.yaml");
          try {
            await fsp.access(lock);
            importers.push(path.join(base, trimmed));
          } catch {}
        }
      }
      if (importers.length) {
        const updater = path.join(repo, "tools/dev/update-pnpm-hash.ts");
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
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/dev/gen-importer-roots-bzl.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "gen-langs",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/dev/gen-langs.ts")}`,
      withZx: true,
      when: true,
    },
    {
      label: "glue-pipeline",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/glue-pipeline.ts")}`,
      withZx: true,
      // Always run: glue-pipeline is idempotent and language drivers are no-ops when inactive.
      // Skipping based on a manifest-derived capability set is brittle in temp/sparse repos
      // where the manifest may be missing or partially parsed.
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
    // Execute language/gen tasks in the workspace root to generate files in the temp repo when running tests
    await $({ stdio: "inherit", cwd: wsRoot, env })`bash --noprofile --norc -c ${c.cmd}`;
  }
}
