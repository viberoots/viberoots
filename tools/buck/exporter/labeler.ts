#!/usr/bin/env zx-wrapper
import { buildPkgIndexes, reachableImports } from "./golist";
import type { Batch, GoPkg, Node } from "./types";

export function effectiveModuleKey(p: GoPkg): string | null {
  const m = p.Module;
  if (!m) return null;
  const pathEff = (m.Replace && m.Replace.Path) || m.Path || "";
  const verEff = (m.Replace && m.Replace.Version) || m.Version || "";
  if (!pathEff) return null;
  const key = `${pathEff}@${verEff || "unknown"}`.toLowerCase();
  return key;
}

export async function attachGoModuleLabels(
  nodes: Node[],
  batches: Batch[],
  cacheDir: string,
): Promise<Node[]> {
  const results: Array<{ members: Node[]; labelsByTarget: Map<string, Set<string>> }> = [];
  for (const b of batches) {
    // `b` is expected to carry members, roots, cwd; caller already executed go list per batch
    // For testability, we recompute indexes from a fresh go list run at call site and pass pkgs in; here we assume caller passed pkgs via context.
    // To keep module small, we rebuild indexes per batch using a closure consumer.
    const pkgs = (global as any).__GO_LIST_CACHE?.get?.(b) as GoPkg[] | undefined;
    if (!pkgs) continue;
    const { byImport, byDir, testByDir } = buildPkgIndexes(pkgs);
    const labelsByTarget = new Map<string, Set<string>>();
    for (const n of b.members) {
      const dirs = dirCandidates(n);
      const moduleKeys = new Set<string>();
      for (const d of dirs) {
        const rootPkg = byDir.get(d);
        if (!rootPkg) continue;
        const isTestTarget = ((n as any).srcs || []).some((s: string) => /_test\.go$/.test(s));
        const seeds: GoPkg[] = [rootPkg];
        if (isTestTarget) {
          for (const tpkg of testByDir.get(d) || []) seeds.push(tpkg);
        }
        const include = new Set<string>();
        for (const seed of seeds) {
          if (!seed.ImportPath) continue;
          include.add(seed.ImportPath);
          const reach = reachableImports(seed, byImport);
          for (const ip of reach) include.add(ip);
        }
        for (const ip of include) {
          const p = byImport.get(ip);
          if (!p) continue;
          const key = effectiveModuleKey(p);
          if (key) moduleKeys.add(`module:${key}`);
        }
      }
      labelsByTarget.set(n.name, moduleKeys);
    }
    results.push({ members: b.members, labelsByTarget });
  }

  const labelsLookup = new Map<string, Set<string>>();
  for (const r of results) {
    for (const [t, set] of r.labelsByTarget) {
      const cur = labelsLookup.get(t) || new Set<string>();
      for (const x of set) cur.add(x);
      labelsLookup.set(t, cur);
    }
  }

  return nodes.map((n) => {
    if (!isGoNode(n)) return n;
    const keep = (n.labels || []).filter((l) => !l.startsWith("module:"));
    const add = Array.from(labelsLookup.get(n.name) || new Set<string>());
    return { ...n, labels: [...keep, ...add] };
  });
}

function isGoNode(n: Node): boolean {
  if ((n.rule_type || "").startsWith("go_")) return true;
  const labs = n.labels || [];
  return labs.includes("lang:go");
}

function dirCandidates(n: Node): string[] {
  const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
  const pkg = n.name.match(/^\/\/(.+):[^:]+$/)?.[1] || ".";
  const out = new Set<string>();
  if (srcs.length === 0) out.add(pkg);
  for (const s of srcs) {
    const slash = s.lastIndexOf("/");
    if (slash < 0) out.add(pkg);
    else out.add(s.slice(0, slash));
  }
  return Array.from(out);
}
