#!/usr/bin/env zx-wrapper
/**
 * tools/buck/export-graph.ts — Configured Buck graph exporter with Go module labels
 * Generated file is not committed. See build-system-design.md (Exporting the Buck Graph (ZX)).
 */
import fs from "fs-extra";

type Node = {
  name: string;
  rule_type: string;
  labels?: string[];
};

const out = (argv.out as string) || "tools/buck/graph.json";
const scope = (argv.scope as string) || ""; // e.g., "label:go" to limit local runs

const attrList = [
  "name",
  "rule_type",
  "srcs",
  "deps",
  "labels",
  "args",
  "env",
  "main",
  "main_class",
  "includes",
  "defines",
  "cflags",
  "ldflags",
];

function isGoRule(rt: string): boolean {
  return rt.startsWith("go_");
}

async function exportConfiguredGraph(): Promise<Node[]> {
  const query = scope
    ? `attrfilter(labels, ${scope}, deps(//..., 1, exec_deps()))`
    : `deps(//..., 1, exec_deps())`;
  const flags = attrList.flatMap((a) => ["--output-attribute", a]);
  const { stdout } = await $`buck2 cquery ${query} --json ${flags}`;
  const obj = JSON.parse(String(stdout)) as Record<string, any>;
  const nodes: Node[] = Object.values(obj) as any[];
  // No Go targets in this repo yet; phase 3 implementation remains schema-ready.
  // When Go targets exist, add batching + go list to attach module: labels here.
  const normalized = nodes.map((n) => ({
    ...n,
    labels: Array.from(new Set(n.labels || [])).sort(),
  }));
  return normalized.sort((a, b) => a.name.localeCompare(b.name));
}

async function writeAtomicJSON(file: string, data: any) {
  const txt = JSON.stringify(data, null, 2);
  const tmp = file + ".tmp";
  await fs.outputFile(tmp, txt, "utf8");
  await fs.move(tmp, file, { overwrite: true });
}

async function main() {
  const nodes = await exportConfiguredGraph();
  await writeAtomicJSON(out, nodes);
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
