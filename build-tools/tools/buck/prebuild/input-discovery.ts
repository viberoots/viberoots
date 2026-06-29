#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildToolsRoot } from "../../dev/dev-build/paths";

const TOOL_SOURCE_DIRS = [
  "tools/buck",
  "tools/dev/dev-build",
  "tools/dev/install",
  "tools/dev/update-pnpm-hash",
  "tools/node",
];

const TOOL_SOURCE_FILES = new Set([
  "tools/dev/gen-importer-roots-bzl.ts",
  "tools/dev/gen-langs.ts",
  "tools/dev/gen-nix-attr-aliases-bzl.ts",
  "tools/dev/update-pnpm-hash.ts",
  "tools/lib/importer-roots.json",
  "tools/lib/nix-attr-aliases.json",
  "tools/nix/langs.json",
]);

export async function discoverPrebuildInputs(root = process.cwd()): Promise<string[]> {
  const result: string[] = [];
  const ignoreDirs = new Set([
    ".git",
    "buck-out",
    "node_modules",
    "coverage",
    ".clinic",
    ".direnv",
    ".viberoots",
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
    if (isToolSourceInput(rel)) return true;
    return false;
  };

  const shouldIncludeToolSource = (rel: string): boolean => {
    if (TOOL_SOURCE_FILES.has(rel)) return true;
    if (!/\.(ts|mjs|json|nix|bzl)$/.test(rel)) return false;
    return TOOL_SOURCE_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  };

  const addInput = (filePath: string): void => {
    const rel = path.relative(root, filePath).replace(/\\/g, "/");
    const value = rel && !rel.startsWith("../") && rel !== ".." ? rel : filePath;
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
  };

  async function walk(dirAbs: string): Promise<void> {
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
      addInput(path.join(dirAbs, e.name));
    }
  }

  async function walkToolSource(buildToolsRootAbs: string, dirRel: string): Promise<void> {
    const dirAbs = path.join(buildToolsRootAbs, dirRel);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childAbs = path.join(dirAbs, e.name);
      const childRel = path.relative(buildToolsRootAbs, childAbs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (ignoreDirs.has(e.name)) continue;
        await walkToolSource(buildToolsRootAbs, childRel);
        continue;
      }
      if (!shouldIncludeToolSource(childRel)) continue;
      addInput(childAbs);
    }
  }

  async function addActiveToolSourceInputs(): Promise<void> {
    const activeBuildToolsRoot = buildToolsRoot(root);
    for (const dir of TOOL_SOURCE_DIRS) {
      await walkToolSource(activeBuildToolsRoot, dir);
    }
    for (const file of TOOL_SOURCE_FILES) {
      const abs = path.join(activeBuildToolsRoot, file);
      try {
        const stat = await fsp.stat(abs);
        if (stat.isFile()) addInput(abs);
      } catch {}
    }
  }

  await walk(root);
  await addActiveToolSourceInputs();
  result.sort();
  return result;
}

function isToolSourceInput(rel: string): boolean {
  const normalized = rel.startsWith("viberoots/build-tools/")
    ? rel.slice("viberoots/build-tools/".length)
    : rel.startsWith("build-tools/")
      ? rel.slice("build-tools/".length)
      : rel;
  if (TOOL_SOURCE_FILES.has(normalized)) return true;
  if (!/\.(ts|mjs|json|nix|bzl)$/.test(normalized)) return false;
  return TOOL_SOURCE_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}
