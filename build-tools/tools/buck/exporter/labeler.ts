#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildPkgIndexes, reachableImports } from "./golist";
import type { Batch, GoListByBatch, GoPkg, Node } from "./types";

export function effectiveModuleKey(p: GoPkg): string | null {
  const m = p.Module;
  if (!m) return null;
  const pathEff = m.Path || "";
  const verEff = (m.Replace && m.Replace.Version) || m.Version || "";
  if (!pathEff) return null;
  const key = `${pathEff}@${verEff || "unknown"}`.toLowerCase();
  return key;
}

export async function attachGoModuleLabels(
  nodes: Node[],
  batches: Batch[],
  goListByBatch: GoListByBatch | undefined,
): Promise<Node[]> {
  if (batches.length === 0) {
    return nodes;
  }
  if (!goListByBatch) {
    throw new Error(
      "[exporter][go] missing go list results map for Go labeling; caller must provide per-batch go list results",
    );
  }
  const results: Array<{ members: Node[]; labelsByTarget: Map<string, Set<string>> }> = [];
  for (const b of batches) {
    const pkgs = goListByBatch.get(b);
    if (!pkgs) {
      throw new Error(
        [
          "[exporter][go] missing go list results for batch; labeling requires authoritative go list outputs.",
          `batch.cwd=${b.cwd}`,
          `batch.tuple=${JSON.stringify(b.tuple)}`,
        ].join(" "),
      );
    }
    const { byImport, byDir, testByDir } = buildPkgIndexes(pkgs);
    const { byModDir, testByModDir } = buildModuleRootIndexes(pkgs, b.cwd);
    const labelsByTarget = new Map<string, Set<string>>();
    for (const n of b.members) {
      const dirs = dirCandidates(n);
      const moduleKeys = new Set<string>();
      for (const d of dirs) {
        const modRel = moduleRelativeDir(b.cwd, d);
        const rootPkg = byDir.get(d) || byModDir.get(modRel);
        if (!rootPkg) continue;
        const isTestTarget = ((n as any).srcs || []).some((s: string) => /_test\.go$/.test(s));
        const seeds: GoPkg[] = [rootPkg];
        if (isTestTarget) {
          const tests = testByDir.get(d) || testByModDir.get(modRel) || [];
          if (tests.length === 0) {
            // Secondary fallback: include any pkgs in same dir flagged with ForTest
            for (const p of byImport.values()) {
              if (p.ForTest && p.ForTest !== "" && p.Dir && rootPkg.Dir && p.Dir === rootPkg.Dir) {
                seeds.push(p);
              }
            }
          } else {
            for (const tpkg of tests) seeds.push(tpkg);
          }
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

function moduleRelativeDir(moduleRoot: string, repoRelativeDir: string): string {
  const rel = path.relative(moduleRoot || ".", repoRelativeDir || ".");
  if (!rel || rel === "") return ".";
  // Normalize Windows separators defensively; Buck paths should already be POSIX-like.
  return rel.replaceAll("\\", "/");
}

function normalizeGoDirAbs(dirAbs: string): string {
  // macOS sometimes returns /private/var/... while file paths may use /var/...
  return dirAbs.startsWith("/private/var/") ? dirAbs.slice("/private".length) : dirAbs;
}

function buildModuleRootIndexes(
  pkgs: GoPkg[],
  moduleRoot: string,
): {
  byModDir: Map<string, GoPkg>;
  testByModDir: Map<string, GoPkg[]>;
} {
  const byModDir = new Map<string, GoPkg>();
  const testByModDir = new Map<string, GoPkg[]>();
  const moduleRootAbs = path.resolve(process.cwd(), moduleRoot || ".");
  for (const p of pkgs) {
    if (!p.Dir) continue;
    const abs = normalizeGoDirAbs(p.Dir);
    const rel = path.relative(moduleRootAbs, abs);
    const key = rel === "" ? "." : rel.replaceAll("\\", "/");
    const isTestPkg = (p.ImportPath || "").endsWith(".test") || (!!p.ForTest && p.ForTest !== "");
    const existing = byModDir.get(key);
    if (
      !existing ||
      (!isTestPkg &&
        existing &&
        ((existing.ImportPath || "").endsWith(".test") ||
          (existing.ForTest && existing.ForTest !== "")))
    ) {
      if (!isTestPkg || !byModDir.has(key)) {
        byModDir.set(key, p);
      }
    }
    if (isTestPkg) {
      const arr = testByModDir.get(key) || [];
      arr.push(p);
      testByModDir.set(key, arr);
    }
  }
  return { byModDir, testByModDir };
}
