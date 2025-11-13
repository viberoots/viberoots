#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { Node } from "./types.ts";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-view.ts";

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
  // Limit scan roots to avoid parsing ephemeral or intentionally invalid packages (e.g., .tmp)
  const defaultRoots = ["apps", "libs", "third_party", "go", "cpp"];
  const rootsEnv = (process.env.BUCK_QUERY_ROOTS || "").trim();
  const rootsList = rootsEnv ? rootsEnv.split(/[\,\s]+/).filter(Boolean) : defaultRoots;
  // Filter to existing directories to avoid recursive spec errors in sparse/temp repos
  const fs = await import("node:fs");
  const rootsExisting = rootsList.filter((r) => {
    const dir = r.replace(/^\/+/, "");
    try {
      return fs.existsSync(path.join(process.cwd(), dir));
    } catch {
      return false;
    }
  });
  const rootsForExpr = rootsExisting.length > 0 ? rootsExisting : ["libs"];
  const rootsExpr = `set(${rootsForExpr
    .map((r) => (r.startsWith("//") ? `${r}/...` : `//${r}/...`))
    .join(" ")})`;
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
    const qScoped = q.replaceAll("//...", rootsExpr);
    const query = scope ? `attrfilter(labels, ${scope}, ${qScoped})` : qScoped;
    if ((process.env.EXPORTER_DEBUG || "").trim() === "1") {
      console.warn(`[exporter][debug] buck2 cquery ${platformFlags.join(" ")} ${query}`);
    }
    const { stdout } = await $({
      stdio: "pipe",
    })`buck2 ${isolationFlags} cquery ${platformFlags} ${query} --json ${flags}`.quiet();
    return JSON.parse(String(stdout)) as Record<string, any>;
  }

  async function runQuerySafe(q: string): Promise<Record<string, any>> {
    const dbg = (process.env.EXPORTER_DEBUG || "").trim() === "1";
    if (dbg) {
      // In debug mode, surface errors to help diagnose empty graphs
      return await runQuery(q);
    }
    try {
      return await runQuery(q);
    } catch (e) {
      return {} as Record<string, any>;
    }
  }

  let nodes: Node[] = [];
  try {
    // Query regular deps and tests separately, then merge to ensure test nodes are present
    const base = `deps(${rootsExpr}, 1, exec_deps())`;
    // Enumerate configured targets in allowed roots in case deps(...) misses standalone nodes
    const allKind = `kind(".*", ${rootsExpr})`;
    const kindCxxTest = `kind("cxx_test", ${rootsExpr})`;
    const attrCxxTest = `attrfilter(rule_type, "cxx_test", ${rootsExpr})`;
    const kindCxxBin = `kind("cxx_binary", ${rootsExpr})`;
    const attrCxxBin = `attrfilter(rule_type, "cxx_binary", ${rootsExpr})`;
    const cxxPlanner = `filter("__planner$", kind("cxx_library", ${rootsExpr}))`;
    // Explicitly include any targets stamped with lang:cpp to catch repo-local
    // macros (e.g., nix_cpp_*) that don't use cxx_* rule_types.
    const labeledCpp = `attrfilter(labels, "lang:cpp", ${rootsExpr})`;
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
      // Normalize label: drop cell prefix and any config suffix to ensure stable keys
      const { normalizeTargetLabel } = await import("../../lib/labels.ts");
      const clean = normalizeTargetLabel(label);
      const n: any = {
        ...a,
        name: clean,
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
  // Exclude ephemeral or test-generated packages (e.g., .tmp/*) that can contain
  // intentionally invalid TARGETS used by zx tests. These should not participate
  // in graph export for glue generation.
  nodes = nodes.filter((n) => {
    const name = String((n as any)?.name || "");
    // Match // .tmp / paths across cells (e.g., root//.tmp/foo:bar or //.tmp/foo:bar)
    return !/\/\/\.tmp\//.test(name);
  });
  return nodes;
}

export async function readSimulatedNodes(path: string): Promise<Node[]> {
  const txt = await fsp.readFile(path, "utf8");
  const data = JSON.parse(txt);
  if (Array.isArray(data)) return data as Node[];
  if (data && typeof data === "object" && Array.isArray((data as any).nodes)) {
    return (data as any).nodes as Node[];
  }
  return [] as Node[];
}

export async function writeIfChangedJSON(file: string, data: any) {
  const { writeIfChanged } = await import("../../lib/fs-helpers.ts");
  const txt = JSON.stringify(data, null, 2) + "\n";
  // Avoid stomping a previously non-empty graph with an empty list due to
  // transient query conditions. If the existing file has non-empty content
  // and the new content is an empty array, keep the existing graph.
  try {
    const cur = await (await import("node:fs/promises")).readFile(file, "utf8");
    const curTrim = cur.trim();
    const isCurNonEmpty = curTrim !== "" && curTrim !== "[]";
    if (Array.isArray(data) && data.length === 0 && isCurNonEmpty) {
      return;
    }
  } catch {}
  await writeIfChanged(file, txt);
}

export function parseArgs(argv: any): {
  out: string;
  scope: string;
  simulate: string;
  maxParallel: number;
  cacheDir: string;
  metricsOut: string;
  validation: "warn" | "error";
} {
  const a: Record<string, any> = argv && typeof argv === "object" ? argv : {};
  return {
    out: (a.out as string) || DEFAULT_GRAPH_PATH,
    scope: (a.scope as string) || "",
    simulate: (a.simulate as string) || "",
    maxParallel: Number(a["max-parallel"] || 4),
    cacheDir: (a["cache-dir"] as string) || "tools/buck/.export-cache",
    metricsOut: (a["metrics-out"] as string) || "",
    validation:
      ((a["validation"] as string) || (process.env.EXPORTER_VALIDATION as string) || "error") ===
      "warn"
        ? "warn"
        : "error",
  };
}
