#!/usr/bin/env zx-wrapper
import { writeIfChanged } from "../lib/fs-helpers";
import { readGraph } from "../lib/graph";
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

const graphPath = getArg("graph", "tools/buck/graph.json");
const outPath = getArg("out", "third_party/providers/auto_map.bzl");

// writeIfChanged now imported from ../lib/fs-helpers

// parsing moved to tools/lib/labels.ts

async function main() {
  const list = (await readGraph(graphPath)) as Node[];
  const mapping: Record<string, string[]> = {};
  for (const n of list) {
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
