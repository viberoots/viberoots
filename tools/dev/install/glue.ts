#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export function zxNodeBase(): string {
  const zxInit = path.resolve("tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

export async function runGlue(dryRun: boolean, verbose: boolean) {
  const nodeBase = zxNodeBase();
  const nodeBin = process.execPath || "node";
  const cmds: Array<{ label: string; cmd: string }> = [
    {
      label: "export-graph",
      cmd: `${nodeBin} ${nodeBase} tools/buck/export-graph.ts --out tools/buck/graph.json`,
    },
    { label: "sync-providers-go", cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers.ts` },
    {
      label: "sync-providers-node",
      cmd: `${nodeBin} ${nodeBase} tools/buck/sync-providers-node.ts`,
    },
    {
      label: "gen-auto-map",
      cmd: `${nodeBin} ${nodeBase} tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`,
    },
  ];
  for (const c of cmds) {
    if (dryRun) {
      console.log(`[dry-run] ${c.cmd}`);
      continue;
    }
    if (verbose) console.log(`[run] ${c.cmd}`);
    await $({ stdio: "inherit" })`bash --noprofile --norc -c ${c.cmd}`;
  }
}
