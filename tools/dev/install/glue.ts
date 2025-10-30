#!/usr/bin/env zx-wrapper
import path from "node:path";
import { printSkip } from "../../lib/errors.ts";

function repoRoot(): string {
  // Resolve relative to this file to avoid accidental parent cwd resolution
  const here = path.dirname(new URL(import.meta.url).pathname);
  // File lives at tools/dev/install/glue.ts → repo root is three levels up
  return path.resolve(here, "..", "..", "..");
}

export function zxNodeBase(): string {
  const zxInit = path.resolve(repoRoot(), "tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

async function ensurePreludeSymlinkIfMissing() {
  try {
    const check = await $({
      stdio: "pipe",
      cwd: repoRoot(),
    })`bash --noprofile --norc -c 'test -e prelude'`;
    if (check.exitCode === 0) return;
  } catch {}
  let out = "";
  try {
    const res = await $({
      stdio: "pipe",
      cwd: repoRoot(),
    })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
    out =
      String(res.stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
  } catch {}
  if (!out) {
    try {
      const ev = await $({ stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
      out = String(ev.stdout || "").trim();
    } catch {}
  }
  if (!out) return;
  try {
    await $({ cwd: repoRoot() })`ln -s ${out + "/prelude"} prelude`;
  } catch {}
}

export async function runGlue(dryRun: boolean, verbose: boolean) {
  const nodeBase = zxNodeBase();
  const nodeBin = process.execPath || "node";
  const zxImport = path.join(repoRoot(), "tools/dev/zx-init.mjs");
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

  // If Node is enabled, proactively reconcile pnpm fixed-output hashes for any
  // discovered importers with a pnpm-lock.yaml. This avoids placeholder-digest
  // mismatches during glue-only runs used by scaffolding tests.
  if (haveNode) {
    try {
      const repo = repoRoot();
      // Reuse the importer discovery logic from install/deps-main.ts (inline here to keep deps minimal)
      const importers: string[] = [];
      for (const base of ["apps", "libs"]) {
        const baseAbs = path.join(repo, base);
        try {
          const { stdout } = await $({
            stdio: "pipe",
          })`bash --noprofile --norc -c ${`test -d ${baseAbs} && ls -1 ${baseAbs}`}`;
          for (const d of String(stdout || "").split(/\r?\n/)) {
            const name = d.trim();
            if (!name) continue;
            const impDir = path.join(repo, base, name);
            const lock = path.join(impDir, "pnpm-lock.yaml");
            try {
              const res = await $({
                stdio: "pipe",
              })`bash --noprofile --norc -c ${`test -f ${lock}`}`;
              if (res.exitCode === 0) {
                importers.push(path.join(base, name));
              }
            } catch {}
          }
        } catch {}
      }
      if (importers.length) {
        const updater = path.join(repo, "tools/dev/update-pnpm-hash.ts");
        for (const imp of importers) {
          const relLock = path.join(imp, "pnpm-lock.yaml");
          const cmd = `zx-wrapper ${updater} --lockfile ${relLock}`;
          if (dryRun) {
            console.log(`[dry-run] ${cmd}`);
          } else {
            if (verbose) console.log(`[run] ${cmd}`);
            await $({
              stdio: "inherit",
              cwd: repo,
              env: { ...process.env, INSTALL_LOCK_SKIP: "1" },
            })`bash --noprofile --norc -c ${cmd}`;
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
      label: "export-graph",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/export-graph.ts")} --out ${path.join(repoRoot(), "tools/buck/graph.json")}`,
      withZx: true,
      when: true,
    },
    {
      label: "sync-providers-go",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/sync-providers.ts")}`,
      withZx: true,
      when: haveGo && goCaps.patching !== false,
      skipReason: haveGo
        ? goCaps.patching === false
          ? "not-applicable"
          : undefined
        : "missing-language",
    },
    {
      label: "sync-providers-cpp",
      cmd: `${nodeBin} ${nodeBase} ${path.join(
        repoRoot(),
        "tools/buck/sync-providers.ts",
      )} --lang=cpp`,
      withZx: true,
      // Always run when C++ is enabled; overlay/lockfile stamps are required even if patching is false
      when: haveCpp,
      skipReason: haveCpp ? undefined : "missing-language",
    },
    {
      label: "sync-providers-node",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/sync-providers-node.ts")}`,
      withZx: true,
      when: haveNode && nodeCaps.patching !== false,
      skipReason: haveNode
        ? nodeCaps.patching === false
          ? "not-applicable"
          : undefined
        : "missing-language",
    },
    {
      label: "gen-auto-map",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/gen-auto-map.ts")} --graph ${path.join(repoRoot(), "tools/buck/graph.json")} --out ${path.join(repoRoot(), "third_party/providers/auto_map.bzl")}`,
      withZx: true,
      // Generate when any enabled language claims either patching or lockfile labeling capability; otherwise skip
      when: (() => {
        for (const id of enabledLangs) {
          const c = caps.get(id) || {};
          if (c.patching || c.lockfileLabels) return true;
        }
        return enabledLangs.size === 0; // default to run if no explicit enabled set
      })(),
      skipReason: "not-applicable",
    },
  ];
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
    const env = c.withZx
      ? {
          ...process.env,
          NODE_OPTIONS: [`--import ${zxImport}`, process.env.NODE_OPTIONS || ""]
            .filter(Boolean)
            .join(" "),
        }
      : process.env;
    await $({ stdio: "inherit", cwd: repoRoot(), env })`bash --noprofile --norc -c ${c.cmd}`;
  }
}
