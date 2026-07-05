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
  ".codex-logs",
  ".nix-gcroots",
  "coverage",
  ".cache",
  ".turbo",
  "dist",
  "build",
  ".vite",
  ".next",
  ".wasm-producer",
  ".viberoots/workspace/.viberoots",
  ".viberoots/workspace/backups",
  ".viberoots/workspace/buck",
  ".viberoots/workspace/cache",
  ".viberoots/workspace/codex-test-logs",
  ".viberoots/workspace/install-cache",
  ".viberoots/workspace/nix-xdg-cache",
  ".viberoots/workspace/node",
  ".viberoots/workspace/pr-logs",
  ".viberoots/workspace/viberoots-flake-input",
  ".viberoots/workspace/xdg-cache",
  ".tmp",
  "tmp",
  "test-logs",
  "result",
];
const ROOT_FILE_EXCLUDES = new Set([".full-test-output.log", ".patch-sessions.json"]);
const ROOT_DIR_EXCLUDES = new Set([
  "backups",
  "cache",
  "codex-test-logs",
  "install-cache",
  "nix-xdg-cache",
  "pr-logs",
  "viberoots-flake-input",
  "xdg-cache",
]);
const VIBEROOTS_ROOT_DIR_EXCLUDES = new Set([
  ".cache",
  ".clinic",
  ".codex-logs",
  ".direnv",
  ".nix-gcroots",
  ".pnpm-store",
  ".viberoots",
  "backups",
  "buck-out",
  "cache",
  "codex-test-logs",
  "coverage",
  "install-cache",
  "nix-xdg-cache",
  "node_modules",
  "pr-logs",
  "result",
  "test-logs",
  "xdg-cache",
]);
const GRAPH_PATH_IN_SNAPSHOT = [".viberoots", "workspace", "buck", "graph.json"].join("/");

type FileArg = { rel: string; src: string };
type GraphRecord = Record<string, unknown>;

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
  const normalized = rel.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized === GRAPH_PATH_IN_SNAPSHOT) return false;
  for (const exclude of EXCLUDES) {
    if (!exclude.includes("/")) continue;
    if (normalized === exclude || normalized.startsWith(`${exclude}/`)) return true;
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 1 && ROOT_FILE_EXCLUDES.has(parts[0])) return true;
  if (parts.length === 1 && /^\.codex-.+\.log$/.test(parts[0])) return true;
  if (parts.length === 1 && /^result-.+/.test(parts[0])) return true;
  if (parts.length > 0 && ROOT_DIR_EXCLUDES.has(parts[0])) return true;
  if (
    parts[0] === "viberoots" &&
    parts.length === 2 &&
    (ROOT_FILE_EXCLUDES.has(parts[1]) || /^\.codex-.+\.log$/.test(parts[1]))
  ) {
    return true;
  }
  if (parts[0] === "viberoots" && parts.length > 1 && VIBEROOTS_ROOT_DIR_EXCLUDES.has(parts[1])) {
    return true;
  }
  return parts.some(
    (part, index) => EXCLUDES.includes(part) && (part !== "node_modules" || index === 0),
  );
}

function isRecord(value: unknown): value is GraphRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTargetLabel(label: string): string {
  const noConfig = label.replace(/\s+\(.*\)$/, "");
  const idx = noConfig.indexOf("//");
  return idx >= 0 ? `//${noConfig.slice(idx + 2)}` : noConfig;
}

function normalizeNixAttr(attr: string): string {
  const value = String(attr || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  const prefixed = value.startsWith("pkgs.") ? value : `pkgs.${value}`;
  return prefixed === "pkgs.gtest" ? "pkgs.googletest" : prefixed;
}

function normalizeNixpkgsProfile(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

function sourcePlansFromGraph(raw: unknown) {
  const nodes = Array.isArray(raw)
    ? raw.filter(isRecord)
    : isRecord(raw) && Array.isArray(raw.nodes)
      ? raw.nodes.filter(isRecord)
      : [];
  return nodes.flatMap((node) => {
    const target = normalizeTargetLabel(String(node.name || "").trim());
    if (!target) return [];
    const rawPins = isRecord(node.nixpkg_pins) ? node.nixpkg_pins : {};
    const nixpkg_pins = Object.fromEntries(
      Object.entries(rawPins).flatMap(([attr, rawPin]) => {
        if (!isRecord(rawPin)) return [];
        const normalizedAttr = normalizeNixAttr(attr);
        if (!normalizedAttr) return [];
        return [
          [normalizedAttr, { nixpkgs_profile: normalizeNixpkgsProfile(rawPin.nixpkgs_profile) }],
        ];
      }),
    );
    return [
      { target, nixpkgs_profile: normalizeNixpkgsProfile(node.nixpkgs_profile), nixpkg_pins },
    ];
  });
}

async function sourcePlanEvidenceFromGraphFile(file: string): Promise<unknown[]> {
  if (!file) return [];
  try {
    return sourcePlansFromGraph(JSON.parse(await fsp.readFile(file, "utf8")));
  } catch {
    return [];
  }
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
    sourcePlans: await sourcePlanEvidenceFromGraphFile(graph),
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
