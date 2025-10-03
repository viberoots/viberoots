#!/usr/bin/env zx-wrapper
import path from "node:path";

function repoRoot(): string {
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
  const cmds: Array<{ label: string; cmd: string; withZx?: boolean }> = [
    {
      label: "export-graph",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/export-graph.ts")} --out ${path.join(repoRoot(), "tools/buck/graph.json")}`,
      withZx: true,
    },
    {
      label: "sync-providers-go",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/sync-providers.ts")}`,
      withZx: true,
    },
    {
      label: "sync-providers-node",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/sync-providers-node.ts")}`,
      withZx: true,
    },
    {
      label: "gen-auto-map",
      cmd: `${nodeBin} ${nodeBase} ${path.join(repoRoot(), "tools/buck/gen-auto-map.ts")} --graph ${path.join(repoRoot(), "tools/buck/graph.json")} --out ${path.join(repoRoot(), "third_party/providers/auto_map.bzl")}`,
      withZx: true,
    },
  ];
  await ensurePreludeSymlinkIfMissing();
  for (const c of cmds) {
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
