#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildPkgIndexes, reachableImports, runGoList } from "./golist.ts";
import type { Batch, GoPkg, Node } from "./types.ts";

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
  cacheDir: string,
): Promise<Node[]> {
  const results: Array<{ members: Node[]; labelsByTarget: Map<string, Set<string>> }> = [];
  for (const b of batches) {
    // `b` is expected to carry members, roots, cwd; caller already executed go list per batch
    // For testability, we recompute indexes from a fresh go list run at call site and pass pkgs in; here we assume caller passed pkgs via context.
    // To keep module small, we rebuild indexes per batch using a closure consumer.
    let pkgs = (global as any).__GO_LIST_CACHE?.get?.(b) as GoPkg[] | undefined;
    if (!pkgs) {
      // Fallback: fetch go list for this batch if not present in global cache
      pkgs = await runGoList(b.tuple, b.roots, b.cwd, cacheDir);
    }
    const { byImport, byDir, testByDir } = buildPkgIndexes(pkgs);
    const labelsByTarget = new Map<string, Set<string>>();
    for (const n of b.members) {
      const dirs = dirCandidates(n);
      const moduleKeys = new Set<string>();
      for (const d of dirs) {
        let rootPkg = byDir.get(d);
        if (!rootPkg) {
          // Fallback: resolve by comparing against batch cwd (module root)
          const cwdAbs = path.resolve(process.cwd(), b.cwd);
          for (const p of byImport.values()) {
            const pDir = (p.Dir || "").replace(/^\/private/, "");
            const pDirAbs = path.resolve(pDir);
            const relToProc = path.relative(process.cwd(), pDirAbs);
            const relToBatch = path.relative(cwdAbs, pDirAbs) || ".";
            if (relToProc === d || relToBatch === ".") {
              const isPTest =
                (p.ImportPath || "").endsWith(".test") || (!!p.ForTest && p.ForTest !== "");
              const isTargetTest = ((n as any).srcs || []).some((s: string) =>
                /_test\.go$/.test(s),
              );
              if (!isPTest || isTargetTest) {
                rootPkg = p;
                break;
              }
            }
          }
        }
        if (!rootPkg) continue;
        const isTestTarget = ((n as any).srcs || []).some((s: string) => /_test\.go$/.test(s));
        const seeds: GoPkg[] = [rootPkg];
        if (isTestTarget) {
          const tests = testByDir.get(d) || [];
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
        if (isTestTarget && include.size === 0) {
          // Conservative fallback: parse go.mod requires/replaces to attach module labels
          try {
            const fs = await import("fs-extra");
            const gomodPath = path.resolve(process.cwd(), b.cwd, "go.mod");
            if (await fs.pathExists(gomodPath)) {
              const txt = await fs.readFile(gomodPath, "utf8");
              const req = new Map<string, string>();
              const rep = new Map<string, string>();
              for (const line of txt.split("\n")) {
                const l = line.trim();
                const m1 = l.match(/^require\s+([^\s]+)\s+([^\s]+)$/);
                if (m1) req.set(m1[1], m1[2]);
                const m2 = l.match(
                  /^replace\s+([^\s]+)(?:\s+[^\s]+)?\s+=>\s+([^\s]+)(?:\s+([^\s]+))?$/,
                );
                if (m2) {
                  const mod = m2[1];
                  const tgt = m2[2];
                  const ver = m2[3];
                  if (tgt && tgt.startsWith("http")) continue;
                  if (ver) rep.set(mod, ver);
                }
              }
              for (const [mod, ver] of req) {
                const vEff = rep.get(mod) || ver || "unknown";
                moduleKeys.add(`module:${mod.toLowerCase()}@${vEff}`);
              }
            }
          } catch {}
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
