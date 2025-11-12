#!/usr/bin/env zx-wrapper
import { writeIfChanged } from "../lib/fs-helpers";
// zx is available via shebang; we'll use `$` to interact with git when present.
import { readCompositeGraph } from "../lib/graph-view.ts";
// PR6 (go-cpp-local-patching): provider mapping is Node-only (lockfile:...) and nixpkg; Go `module:`
// labels are kept for diagnostics and are intentionally ignored here.
import { providersForLabels } from "../lib/labels";

type Node = {
  name: string;
  rule_type?: string;
  labels?: string[];
};

function getArg(name: string, def: string): string {
  try {
    const a: any = (global as any).argv;
    if (a && typeof a[name] === "string" && a[name]) return a[name] as string;
  } catch {}
  // Fallback: parse process.argv for --name value
  const idx = process.argv.findIndex((v) => v === `--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1] as string;
  return def;
}

const graphPath = getArg("graph", "");
const outPath = getArg("out", "third_party/providers/auto_map.bzl");

// writeIfChanged now imported from ../lib/fs-helpers

// parsing moved to tools/lib/labels.ts

async function main() {
  // Best-effort: mark the output file as 'assume-unchanged' so that when we
  // overwrite the tracked stub with generated contents, local working trees
  // don't show it as modified. This is a local index hint only; it is safe to
  // ignore errors (e.g., when not in a git work tree or file not tracked).
  try {
    const { stdout, exitCode } = await $({
      stdio: "pipe",
    })`git rev-parse --is-inside-work-tree`.nothrow();
    if (exitCode === 0 && String(stdout || "").trim() === "true") {
      const check = await $({ stdio: "pipe" })`git ls-files --error-unmatch ${outPath}`.nothrow();
      if (check.exitCode === 0) {
        await $({ stdio: "pipe" })`git update-index --assume-unchanged ${outPath}`.nothrow();
      }
    }
  } catch {}

  const { nodes } = await readCompositeGraph({
    graphPath: graphPath || undefined,
  });
  const list = nodes as unknown as Node[];
  const mapping: Record<string, string[]> = {};
  for (const n of list) {
    // PR-1: Skip provider-package nodes to avoid self-mappings in auto_map.
    if (n.name && n.name.startsWith("//third_party/providers:")) {
      continue;
    }
    const provs = providersForLabels(n.labels);
    if (provs.length > 0 && n.name) mapping[n.name] = provs;
  }
  const keys = Object.keys(mapping).sort();
  const body = keys
    .map((k) => `    "${k}": [\n${mapping[k].map((p) => `        "${p}",`).join("\n")}\n    ],`)
    .join("\n\n");
  const header = `# //third_party/providers/auto_map.bzl\n# GENERATED FILE — DO NOT EDIT.\n\nMODULE_PROVIDERS = {\n`;
  const footer = `\n}\n`;
  const data = header + body + footer;
  await writeIfChanged(outPath, data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
