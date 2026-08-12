import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists, repoRoot } from "../../../lib/repo";

export function resolveSourceRoot(): string {
  const envRoot = String(process.env.REPO_ROOT || process.env.LIVE_ROOT || "").trim();
  return envRoot || repoRoot();
}

export async function resolveToolSourceRoot(root: string): Promise<string> {
  const isNixStorePath = (candidate: string): boolean =>
    candidate === "/nix/store" || candidate.startsWith("/nix/store/");
  const hasToolchainSources = async (candidate: string): Promise<boolean> => {
    const resolved = path.resolve(candidate || "");
    if (!resolved) return false;
    return (
      (await pathExists(
        path.join(resolved, "build-tools", "tools", "dev", "gen-toolchain-paths.ts"),
      )) && (await pathExists(path.join(resolved, "toolchains", "toolchain_paths.bzl")))
    );
  };
  const submoduleRoot = path.join(root, "viberoots");
  if (await hasToolchainSources(submoduleRoot)) return submoduleRoot;
  if (await hasToolchainSources(root)) return root;
  const envCandidates = [process.env.VIBEROOTS_SOURCE_ROOT || "", process.env.VIBEROOTS_ROOT || ""];
  for (const candidate of envCandidates) {
    const resolved = path.resolve(candidate || "");
    if (!resolved || isNixStorePath(resolved)) continue;
    if (await hasToolchainSources(resolved)) return resolved;
  }
  for (const candidate of envCandidates) {
    const resolved = path.resolve(candidate || "");
    if (!resolved) continue;
    if (await hasToolchainSources(resolved)) return resolved;
  }
  return root;
}

async function copyFile(src: string, dst: string): Promise<void> {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
}

async function copyOptionalFile(src: string, dst: string): Promise<void> {
  try {
    await copyFile(src, dst);
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
}

async function copyToolchainTree(src: string, dst: string): Promise<void> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  await fsp.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyToolchainTree(srcPath, dstPath);
    else if (entry.isFile()) await copyFile(srcPath, dstPath);
  }
}

export async function ensureToolchainSourcesForTempRepo(tmp: string): Promise<void> {
  const root = resolveSourceRoot();
  const toolSourceRoot = await resolveToolSourceRoot(root);
  const toolchainSrcDir = path.join(toolSourceRoot, "toolchains");
  const legacyToolchainsDir = path.join(tmp, "toolchains");
  const workspaceToolchainsDir = path.join(tmp, ".viberoots", "workspace", "toolchains");
  const sourceWorkspaceBzl = path.join(
    root,
    ".viberoots",
    "workspace",
    "toolchains",
    "toolchain_paths.bzl",
  );
  const sourceWorkspaceJson = path.join(root, ".viberoots", "workspace", "toolchain-paths.json");
  const toolSourceWorkspaceBzl = path.join(
    toolSourceRoot,
    ".viberoots",
    "workspace",
    "toolchains",
    "toolchain_paths.bzl",
  );
  const legacyBzlDst = path.join(legacyToolchainsDir, "toolchain_paths.bzl");
  const workspaceBzlDst = path.join(workspaceToolchainsDir, "toolchain_paths.bzl");
  const jsonDst = path.join(tmp, ".viberoots", "workspace", "toolchain-paths.json");
  await copyToolchainTree(toolchainSrcDir, legacyToolchainsDir);
  await copyToolchainTree(toolchainSrcDir, workspaceToolchainsDir);
  await copyOptionalFile(sourceWorkspaceBzl, legacyBzlDst);
  await copyOptionalFile(sourceWorkspaceBzl, workspaceBzlDst);
  await copyOptionalFile(sourceWorkspaceJson, jsonDst);
  await copyOptionalFile(toolSourceWorkspaceBzl, legacyBzlDst);
  await copyOptionalFile(toolSourceWorkspaceBzl, workspaceBzlDst);
  // Generated JSON contains environment-specific paths. Keep the active
  // workspace JSON authoritative instead of copying nested generated state.
  await copyOptionalFile(sourceWorkspaceJson, jsonDst);
}
