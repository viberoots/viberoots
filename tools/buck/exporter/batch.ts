#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { deriveTupleForNode, tupleKey } from "./env.ts";
import type { Batch, Node, Tuple } from "./types.ts";

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findModuleRootForDirs(dirs: string[]): Promise<string | null> {
  // Walk up from each dir to the repo root looking for the nearest go.mod to stabilize
  // module root detection regardless of current working directory nuances.
  const seen = new Set<string>();
  for (const d0 of dirs) {
    let cur = path.resolve(process.cwd(), d0);
    const root = path.resolve(process.cwd());
    // Limit ascent to the repo root to avoid scanning outside temp workspace
    while (cur.startsWith(root)) {
      const mod = path.join(cur, "go.mod");
      if (await pathExists(mod)) {
        // Return path relative to repo root to match previous semantics
        const rel = path.relative(process.cwd(), cur) || ".";
        if (!seen.has(rel)) seen.add(rel);
        return rel;
      }
      const next = path.dirname(cur);
      if (next === cur) break;
      cur = next;
    }
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
