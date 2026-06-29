import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers";
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
  await syncToolchainTree(src, dst);
  return dst;
}

async function syncToolchainTree(src: string, dst: string): Promise<void> {
  await mkdirWithMacosMetadataExclusion(dst);
  const keep = new Set([".metadata_never_index"]);
  const seen = new Set<string>();
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    seen.add(entry.name);
    if (entry.isDirectory()) {
      await syncToolchainTree(srcPath, dstPath);
    } else if (entry.isFile()) {
      await writeIfChanged(dstPath, await fsp.readFile(srcPath, "utf8"));
    }
  }

  let dstEntries: import("node:fs").Dirent[] = [];
  try {
    dstEntries = await fsp.readdir(dst, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of dstEntries) {
    if (seen.has(entry.name) || keep.has(entry.name)) continue;
    await fsp.rm(path.join(dst, entry.name), { force: true, recursive: true }).catch(() => {});
  }
}

export async function toolchainBzlPaths(root: string): Promise<string[]> {
  const paths = [toolchainBzlPath(root)];
  if (await hasWorkspaceToolchains(root)) {
    const workspaceToolchains = await ensureWorkspaceToolchains(root);
    if (workspaceToolchains) paths.push(path.join(workspaceToolchains, "toolchain_paths.bzl"));
  }
  return Array.from(new Set(paths));
}
