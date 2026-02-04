#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

export function mtimeSafe(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

export async function listInputs(): Promise<string[]> {
  // Primary path: filesystem scanning with a tight allowlist.
  // This must work in non-git environments (e.g. temp repos, Nix store snapshots).
  const result: string[] = [];
  const root = process.cwd();
  const ignoreDirs = new Set([
    ".git",
    "buck-out",
    "node_modules",
    "coverage",
    ".clinic",
    ".direnv",
    ".pnpm-store",
    "result",
  ]);
  const seen = new Set<string>();

  const shouldInclude = (rel: string): boolean => {
    if (!rel) return false;
    if (rel === "TARGETS" || rel.endsWith("/TARGETS")) return true;
    if (rel.endsWith(".bzl")) return true;
    if (rel === "flake.nix" || rel === "flake.lock") return true;
    if (rel.endsWith("/go.mod") || rel.endsWith("/go.sum")) return true;
    if (rel.endsWith("pnpm-lock.yaml") || rel.endsWith("uv.lock")) return true;
    if (rel.startsWith("patches/") && rel.endsWith(".patch")) return true;
    if (rel.startsWith("build-tools/tools/nix/overlays/")) return true;
    return false;
  };

  async function walk(dirAbs: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (ignoreDirs.has(e.name)) continue;
        await walk(path.join(dirAbs, e.name));
        continue;
      }
      const rel = path.relative(root, path.join(dirAbs, e.name)).replace(/\\/g, "/");
      if (!shouldInclude(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      result.push(rel);
    }
  }

  await walk(root);
  result.sort();
  return result;
}

export function listOutputs(): string[] {
  const graphOut = path.join("build-tools", "tools", "buck", "graph.json");
  const nodeLockIdx = path.join("build-tools", "tools", "buck", "node-lock-index.json");
  const invalidationReport = path.join("build-tools", "tools", "buck", "invalidation-report.txt");
  const autoMap = path.join("third_party", "providers", "auto_map.bzl");
  const outs = [
    graphOut,
    nodeLockIdx,
    invalidationReport,
    autoMap,
    // C++ no longer requires provider→attr mapping; keep only auto_map for Node.
  ];
  try {
    const dir = "third_party/providers";
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^TARGETS.*\.auto$/.test(f)) outs.push(path.join(dir, f));
    }
  } catch {}
  return outs;
}

export function hasPatchesOrLocks(inputs: string[]): boolean {
  return (
    inputs.some((f) => f.startsWith("patches/") && f.endsWith(".patch")) ||
    inputs.some((f) => f.endsWith("pnpm-lock.yaml")) ||
    inputs.includes("flake.lock") ||
    inputs.some((f) => f.startsWith("build-tools/tools/nix/overlays/"))
  );
}

export function missingProviderAutos(): boolean {
  try {
    const dir = "third_party/providers";
    if (!fs.existsSync(dir)) return true;
    return !fs.readdirSync(dir).some((f) => /^TARGETS.*\.auto$/.test(f));
  } catch {
    return true;
  }
}
