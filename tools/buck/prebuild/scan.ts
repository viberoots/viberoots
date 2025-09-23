#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

export function mtimeSafe(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

export async function listInputs(): Promise<string[]> {
  try {
    const { stdout } = await $`git ls-files -z`;
    const raw = String(stdout || "");
    const files = raw.split("\0").filter(Boolean);
    return files.filter(
      (f) =>
        f === "TARGETS" ||
        f.endsWith("/TARGETS") ||
        f.endsWith(".bzl") ||
        (f.startsWith("patches/") && f.endsWith(".patch")) ||
        f.endsWith("pnpm-lock.yaml"),
    );
  } catch {
    const result: string[] = [];
    const root = process.cwd();
    const ignoreDirs = new Set([
      ".git",
      "buck-out",
      "node_modules",
      "coverage",
      ".clinic",
      ".direnv",
      "result",
    ]);
    async function walk(dir: string) {
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name));
        if (e.isDirectory()) {
          if (ignoreDirs.has(e.name)) continue;
          await walk(path.join(dir, e.name));
        } else {
          if (
            e.name === "TARGETS" ||
            e.name.endsWith(".bzl") ||
            (rel.startsWith("patches/") && e.name.endsWith(".patch")) ||
            e.name === "pnpm-lock.yaml"
          ) {
            result.push(rel);
          }
        }
      }
    }
    await walk(root);
    return result;
  }
}

export function listOutputs(): string[] {
  const outs = ["tools/buck/graph.json", "third_party/providers/auto_map.bzl"];
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
    inputs.some((f) => f.endsWith("pnpm-lock.yaml"))
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
