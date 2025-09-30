#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import type { Node } from "./types.ts";

export const attrList = [
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

export async function cqueryNodes(scope: string, attrs: string[]): Promise<Node[]> {
  const base = `deps(//..., 1, exec_deps())`;
  const query = scope ? `attrfilter(labels, ${scope}, ${base})` : base;
  const flags = attrs.flatMap((a) => ["--output-attribute", a]);
  const platformFlags = ["--target-platforms", "prelude//platforms:default"];
  const { stdout } = await $`buck2 cquery ${platformFlags} ${query} --json ${flags}`;
  const obj = JSON.parse(String(stdout)) as Record<string, any>;
  const nodes: Node[] = [];
  for (const [label, raw] of Object.entries(obj)) {
    const a = (raw || {}) as Record<string, any>;
    // Normalize possible buck.* keys to canonical names expected downstream
    const ruleType: string | undefined =
      typeof a["rule_type"] === "string"
        ? (a["rule_type"] as string)
        : (a["buck.type"] as string | undefined);
    const deps: string[] | undefined = Array.isArray(a["deps"])
      ? (a["deps"] as string[])
      : Array.isArray(a["buck.deps"])
        ? (a["buck.deps"] as string[])
        : undefined;
    const labelsArr: string[] | undefined = Array.isArray(a["labels"])
      ? (a["labels"] as string[])
      : Array.isArray(a["buck.labels"])
        ? (a["buck.labels"] as string[])
        : undefined;
    const srcsArr: string[] | undefined = Array.isArray(a["srcs"])
      ? (a["srcs"] as string[])
      : Array.isArray(a["buck.srcs"])
        ? (a["buck.srcs"] as string[])
        : undefined;

    // Do not add heuristic labels; rely only on authoritative rule_type or macro-stamped labels
    const labs = new Set<string>(labelsArr || []);

    const n: any = {
      ...a,
      name: label,
      rule_type: ruleType || a["rule_type"] || "",
      deps: deps || a["deps"],
      labels: Array.from(labs),
      srcs: srcsArr || a["srcs"],
    };
    nodes.push(n as Node);
  }
  return nodes;
}

export async function readSimulatedNodes(path: string): Promise<Node[]> {
  const txt = await fs.readFile(path, "utf8");
  return JSON.parse(txt) as Node[];
}

export async function writeIfChangedJSON(file: string, data: any) {
  const { writeIfChanged } = await import("../../lib/fs-helpers.ts");
  const txt = JSON.stringify(data, null, 2) + "\n";
  await writeIfChanged(file, txt);
}

export function parseArgs(argv: any): {
  out: string;
  scope: string;
  simulate: string;
  maxParallel: number;
  cacheDir: string;
  metricsOut: string;
} {
  return {
    out: (argv.out as string) || "tools/buck/graph.json",
    scope: (argv.scope as string) || "",
    simulate: (argv.simulate as string) || "",
    maxParallel: Number(argv["max-parallel"] || 4),
    cacheDir: (argv["cache-dir"] as string) || "tools/buck/.export-cache",
    metricsOut: (argv["metrics-out"] as string) || "",
  };
}
