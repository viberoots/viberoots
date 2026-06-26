import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { buildToolsRoot } from "./dev-build/paths";

const BZL_REL = path.join("toolchains", "toolchain_paths.bzl");

function activeViberootsRoot(root: string): string {
  return path.dirname(buildToolsRoot(root));
}

function toolchainBzlPath(root: string): string {
  return path.join(activeViberootsRoot(root), BZL_REL);
}

function workspaceToolchainsRoot(root: string): string {
  return path.join(root, ".viberoots", "workspace", "toolchains");
}

async function hasWorkspaceToolchains(root: string): Promise<boolean> {
  try {
    await fsp.access(path.join(root, ".viberoots", "workspace"));
    return true;
  } catch {
    return false;
  }
}

async function ensureWorkspaceToolchains(root: string): Promise<string> {
  const dst = workspaceToolchainsRoot(root);
  const src = path.join(activeViberootsRoot(root), "toolchains");
  try {
    await fsp.access(path.join(src, "TARGETS"));
  } catch {
    return "";
  }
  await mkdirWithMacosMetadataExclusion(dst);
  await fsp.cp(src, dst, {
    errorOnExist: false,
    force: true,
    recursive: true,
  });
  return dst;
}

export async function toolchainBzlPaths(root: string): Promise<string[]> {
  const paths = [toolchainBzlPath(root)];
  if (await hasWorkspaceToolchains(root)) {
    const workspaceToolchains = await ensureWorkspaceToolchains(root);
    if (workspaceToolchains) paths.push(path.join(workspaceToolchains, "toolchain_paths.bzl"));
  }
  return Array.from(new Set(paths));
}
