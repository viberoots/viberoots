#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import type { Node } from "./types.ts";

export const attrList = [
  "name",
  "rule_type",
  "buck.type",
  "srcs",
  "buck.srcs",
  "nix_srcs",
  "deps",
  "buck.deps",
  "labels",
  "buck.labels",
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
  const flags = attrs.flatMap((a) => ["--output-attribute", a]);
  const platformFlags = ["--target-platforms", "prelude//platforms:default"];
  // Buck disallows recursive invocations unless an isolation dir NAME is set.
  // It must be a simple directory name, not a path.
  const iso = process.env.BUCK_ISOLATION_DIR || `exporter-${process.pid}-${Date.now()}`;

  async function runQuery(q: string): Promise<Record<string, any>> {
    const query = scope ? `attrfilter(labels, ${scope}, ${q})` : q;
    const { stdout } =
      await $`buck2 --isolation-dir ${iso} cquery ${platformFlags} ${query} --json ${flags}`;
    return JSON.parse(String(stdout)) as Record<string, any>;
  }

  async function runQuerySafe(q: string): Promise<Record<string, any>> {
    try {
      return await runQuery(q);
    } catch {
      return {} as Record<string, any>;
    }
  }

  // Query regular deps and tests separately, then merge to ensure test nodes are present
  const base = `deps(//..., 1, exec_deps())`;
  const kindCxxTest = `kind("cxx_test", //...)`;
  const attrCxxTest = `attrfilter(rule_type, "cxx_test", //...)`;
  const [obj1, obj2, obj3] = await Promise.all([
    runQuerySafe(base),
    runQuerySafe(kindCxxTest),
    runQuerySafe(attrCxxTest),
  ]);
  const merged: Record<string, any> = { ...obj1, ...obj2, ...obj3 };

  const nodes: Node[] = [];
  for (const [label, raw] of Object.entries(merged)) {
    const a = (raw || {}) as Record<string, any>;
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
