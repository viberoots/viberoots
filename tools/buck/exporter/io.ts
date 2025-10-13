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
  // It must be a simple directory name, not a path. Allow disabling in pure sandbox.
  // Prefer nesting under a parent isolation when provided so parent cleanup can reap child daemons.
  // Fallback to per-process exporter isolation when no parent isolation is present.
  const parentIso = (
    process.env.BUCK_ISOLATION_DIR_EXPORTER ||
    process.env.BUCK_ISOLATION_DIR ||
    ""
  ).trim();
  const iso = parentIso ? `${parentIso}__exporter-${process.pid}` : `exporter-${process.pid}`;
  const isolationFlags = process.env.BUCK_NO_ISOLATION === "1" ? [] : ["--isolation-dir", iso];

  // Ensure isolated buckd is killed if this process is interrupted
  if (process.env.BUCK_NO_ISOLATION !== "1") {
    const onSignal = async () => {
      try {
        await $`buck2 --isolation-dir ${iso} kill`;
      } catch {}
      process.exit(130);
    };
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      try {
        (process as any).on(sig, onSignal);
      } catch {}
    }
  }

  async function runQuery(q: string): Promise<Record<string, any>> {
    const query = scope ? `attrfilter(labels, ${scope}, ${q})` : q;
    const { stdout } = await $({
      stdio: "pipe",
    })`buck2 ${isolationFlags} cquery ${platformFlags} ${query} --json ${flags}`.quiet();
    return JSON.parse(String(stdout)) as Record<string, any>;
  }

  async function runQuerySafe(q: string): Promise<Record<string, any>> {
    try {
      return await runQuery(q);
    } catch {
      return {} as Record<string, any>;
    }
  }

  let nodes: Node[] = [];
  try {
    // Query regular deps and tests separately, then merge to ensure test nodes are present
    const base = `deps(//..., 1, exec_deps())`;
    // Enumerate all configured targets in case deps(...) misses standalone nodes
    const allKind = `kind(".*", //...)`;
    const kindCxxTest = `kind("cxx_test", //...)`;
    const attrCxxTest = `attrfilter(rule_type, "cxx_test", //...)`;
    const kindCxxBin = `kind("cxx_binary", //...)`;
    const attrCxxBin = `attrfilter(rule_type, "cxx_binary", //...)`;
    const cxxPlanner = `filter("__planner$", kind("cxx_library", //...))`;
    // Explicitly include any targets stamped with lang:cpp to catch repo-local
    // macros (e.g., nix_cpp_*) that don't use cxx_* rule_types.
    const labeledCpp = `attrfilter(labels, "lang:cpp", //...)`;
    const [obj0, obj1, obj2, obj3, obj4, obj5, obj6, obj7] = await Promise.all([
      runQuerySafe(allKind),
      runQuerySafe(base),
      runQuerySafe(kindCxxTest),
      runQuerySafe(attrCxxTest),
      runQuerySafe(kindCxxBin),
      runQuerySafe(attrCxxBin),
      runQuerySafe(cxxPlanner),
      runQuerySafe(labeledCpp),
    ]);
    const merged: Record<string, any> = {
      ...obj0,
      ...obj1,
      ...obj2,
      ...obj3,
      ...obj4,
      ...obj5,
      ...obj6,
      ...obj7,
    };

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
  } finally {
    // Scoped cleanup: kill only the exporter-specific buck2 daemon if we started one.
    if (isolationFlags.length > 0) {
      try {
        await $`buck2 --isolation-dir ${iso} kill`;
      } catch {}
    }
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
