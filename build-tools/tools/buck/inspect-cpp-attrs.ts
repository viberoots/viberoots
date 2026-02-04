#!/usr/bin/env zx-wrapper
import { readCompositeGraph } from "../lib/graph-view.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli.ts";

type Args = {
  target?: string | string[];
  json?: boolean;
  graph?: string;
};

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function extractCppAttrs(node: GraphNode): string[] {
  const labels = Array.isArray(node.labels) ? node.labels : [];
  const out: string[] = [];
  for (const l of labels) {
    if (typeof l === "string" && l.startsWith("nixpkg:")) {
      const a = l.slice("nixpkg:".length).trim();
      if (a) out.push(a);
    }
  }
  return Array.from(new Set(out)).sort();
}

async function main() {
  const a = {
    graph: getFlagStr("graph", "").trim(),
    json: getFlagBool("json"),
    target: getFlagList("target"),
  } satisfies Args;
  const { nodes } = await readCompositeGraph({
    graphPath: a.graph || undefined,
  });

  const wanted = new Set<string>(toArray<string>(a.target).map((t) => normalizeTargetLabel(t)));
  const pickAll = wanted.size === 0;

  const result: Record<string, string[]> = {};
  for (const n of nodes) {
    const name = normalizeTargetLabel(n.name);
    if (!name) continue;
    if (!pickAll && !wanted.has(name)) continue;
    const attrs = extractCppAttrs(n);
    if (attrs.length > 0) {
      result[name] = attrs;
    }
  }

  if (a.json) {
    console.log(JSON.stringify({ targets: result }, null, 2));
    return;
  }

  const keys = Object.keys(result).sort();
  if (keys.length === 0) {
    console.log("No C++ nixpkg attrs found for requested targets.");
    return;
  }
  for (const k of keys) {
    console.log(`${k} → ${result[k].join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
