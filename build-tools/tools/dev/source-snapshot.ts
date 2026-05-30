#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const EXCLUDES = [
  ".git",
  ".direnv",
  "node_modules",
  "buck-out",
  ".pnpm-store",
  ".pnpm-home",
  "coverage",
  ".cache",
  ".turbo",
  "dist",
  "build",
  ".vite",
  ".next",
  ".wasm-producer",
  ".tmp",
  "tmp",
  "result",
];
const GRAPH_PATH_IN_SNAPSHOT = ["build-tools", "tools", "buck", "graph.json"].join("/");

type FileArg = { rel: string; src: string };

function argvTokens(): string[] {
  const raw = Array.isArray(process.argv) ? process.argv : [];
  const scriptIdx = raw.findIndex((token, index) => index > 0 && /\.(ts|js|mjs|cjs)$/.test(token));
  return (scriptIdx >= 0 ? raw.slice(scriptIdx + 1) : raw.slice(2)).filter(
    (token) => typeof token === "string",
  );
}

function argValue(tokens: string[], name: string): string {
  const eq = tokens.find((token) => token.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = tokens.indexOf(`--${name}`);
  return i >= 0 ? String(tokens[i + 1] || "") : "";
}

function fileArgs(tokens: string[]): FileArg[] {
  const out: FileArg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "--file") continue;
    const rel = String(tokens[i + 1] || "").replace(/^\/+/, "");
    const src = String(tokens[i + 2] || "");
    if (rel && src) out.push({ rel, src });
    i += 2;
  }
  return out;
}

function forbidden(rel: string): boolean {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  return parts.some(
    (part, index) => EXCLUDES.includes(part) && (part !== "node_modules" || index === 0),
  );
}

async function copyFile(src: string, dest: string): Promise<void> {
  const stat = await fsp.lstat(src);
  if (!stat.isFile() && !stat.isSymbolicLink()) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (stat.isSymbolicLink()) {
    const target = await fsp.readlink(src);
    await fsp.symlink(target, dest).catch(async () => {
      await fsp.rm(dest, { force: true });
      await fsp.symlink(target, dest);
    });
  } else {
    await fsp.copyFile(src, dest);
  }
}

async function walk(dir: string, base: string, files: FileArg[]): Promise<void> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    if (forbidden(rel)) continue;
    if (entry.isDirectory()) await walk(abs, base, files);
    else if (entry.isFile() || entry.isSymbolicLink()) files.push({ rel, src: abs });
  }
}

async function manifestFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(rel);
    }
  }
  await visit(root);
  return out.sort();
}

async function main(): Promise<void> {
  const tokens = argvTokens();
  const out = path.resolve(argValue(tokens, "out"));
  const manifest = path.resolve(argValue(tokens, "manifest"));
  const graph = argValue(tokens, "graph");
  const workspaceRoot = path.resolve(argValue(tokens, "workspace-root") || process.cwd());
  const declaredRoot = argValue(tokens, "declared-root") || out;
  const declaredGraph = argValue(tokens, "declared-graph") || graph;
  if (!out || !manifest) throw new Error("--out and --manifest are required");
  let files = fileArgs(tokens);
  if (files.length === 0) await walk(workspaceRoot, workspaceRoot, files);
  if (graph) files.push({ rel: GRAPH_PATH_IN_SNAPSHOT, src: graph });
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(out, { recursive: true });
  const copied: string[] = [];
  for (const file of files) {
    const rel = file.rel.replace(/^\/+/, "");
    if (!rel || forbidden(rel)) continue;
    if (!fs.existsSync(file.src)) continue;
    await copyFile(file.src, path.join(out, rel));
    copied.push(rel);
  }
  const snapshotFiles = await manifestFiles(out);
  const data = {
    schemaVersion: "viberoots.source-snapshot.v1",
    declaredSnapshotRoot: declaredRoot,
    ambientWorkspaceRoot: workspaceRoot,
    declaredGraphPath: declaredGraph,
    graphPathInSnapshot: GRAPH_PATH_IN_SNAPSHOT,
    excludes: EXCLUDES,
    files: snapshotFiles,
    copiedFiles: [...new Set(copied)].sort(),
  };
  await fsp.mkdir(path.dirname(manifest), { recursive: true });
  await fsp.writeFile(manifest, JSON.stringify(data, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
