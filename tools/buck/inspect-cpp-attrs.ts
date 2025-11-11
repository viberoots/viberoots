#!/usr/bin/env zx-wrapper
import { readCompositeGraph } from "../lib/graph-view.ts";

type Args = {
  target?: string | string[];
  json?: boolean;
  graph?: string;
};

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function cleanName(name?: string): string {
  if (!name) return "";
  const i = name.indexOf(" (config//");
  return i >= 0 ? name.slice(0, i) : name;
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
  const a = (global as any).argv as Args;
  const { nodes } = await readCompositeGraph({
    graphPath: (a.graph as string) || undefined,
  });

  const wanted = new Set<string>(toArray<string>(a.target).map(cleanName));
  const pickAll = wanted.size === 0;

  const result: Record<string, string[]> = {};
  for (const n of nodes) {
    const name = cleanName(n.name);
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
