#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { deriveTupleForNode, tupleKey } from "./env";
import type { Batch, Node, Tuple } from "./types";

export function packageDirFromTargetName(name: string): string {
  const m = name.match(/^\/\/(.+):[^:]+$/);
  return m ? m[1] : ".";
}

export function dirsForTarget(n: Node): string[] {
  const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
  const pkgDir = packageDirFromTargetName(n.name);
  const dirs = new Set<string>();
  if (srcs.length === 0) {
    dirs.add(pkgDir);
  }
  for (const s of srcs) {
    const d = path.dirname(s);
    if (d === ".") dirs.add(pkgDir);
    else dirs.add(d);
  }
  return Array.from(dirs);
}

export async function findModuleRootForDirs(dirs: string[]): Promise<string | null> {
  for (const d of dirs) {
    const mod = path.join(process.cwd(), d, "go.mod");
    if (await fs.pathExists(mod)) return d;
    const parent = path.join(process.cwd(), d, "..", "go.mod");
    if (await fs.pathExists(parent)) return path.join(d, "..");
  }
  return null;
}

export async function buildBatches(nodes: Node[]): Promise<Batch[]> {
  const groups = new Map<
    string,
    { tuple: Tuple; members: Node[]; roots: Set<string>; cwd: string }
  >();
  for (const n of nodes) {
    if (!isGoNode(n)) continue;
    const t = await deriveTupleForNode(n);
    const dirs = dirsForTarget(n);
    const modRoot = await findModuleRootForDirs(dirs);
    if (!modRoot) continue;
    const key = `${tupleKey(t)}|${modRoot}`;
    const entry = groups.get(key) || {
      tuple: t,
      members: [],
      roots: new Set<string>(),
      cwd: modRoot,
    };
    entry.members.push(n);
    for (const d of dirs) entry.roots.add(d);
    groups.set(key, entry);
  }
  return Array.from(groups.values()).map((g) => ({
    tuple: g.tuple,
    members: g.members,
    roots: Array.from(g.roots),
    cwd: g.cwd,
  }));
}

export function isGoNode(n: Node): boolean {
  if ((n.rule_type || "").startsWith("go_")) return true;
  const labs = n.labels || [];
  return labs.includes("lang:go");
}
