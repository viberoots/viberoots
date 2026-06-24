import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbg } from "../lib/util";
import { encodeNixAttrForPatchPrefix, normalizeNixAttr } from "../../lib/providers";
import { copyTree } from "../../lib/copy-tree";
import {
  markMacosMetadataNeverIndex,
  mkdirWithMacosMetadataExclusion,
} from "../../lib/macos-metadata";
import { resolveNixpkg } from "./resolve";
import { chmodRecursive } from "../cross-platform";

const dbg = createDbg("patch-cpp:extract");

export async function extractOrCopySrc(srcPath: string, destDir: string): Promise<string> {
  await fsp.mkdir(destDir, { recursive: true });
  // If srcPath is a directory in the store, copy it. Otherwise, attempt extraction.
  const stat = await fsp.stat(srcPath).catch(() => null);
  if (stat && stat.isDirectory()) {
    console.error("[patch-cpp] extract: copy dir", srcPath);
    await copyTree(srcPath, destDir, { cloneMode: "try", force: true });
    await chmodRecursive(destDir);
    console.error("[patch-cpp] extract: copy dir done");
    return destDir;
  }

  const lower = srcPath.toLowerCase();
  if (lower.endsWith(".zip")) {
    console.error("[patch-cpp] extract: unzip", srcPath);
    await $({ cwd: destDir })`unzip -qq ${srcPath}`.nothrow();
  } else {
    // Extract the full source to ensure expected headers (e.g., zlib.h) are present
    console.error("[patch-cpp] extract: tar -xf full", srcPath);
    await $({ cwd: destDir })`tar -xf ${srcPath}`.nothrow();
  }
  await chmodRecursive(destDir);
  // Heuristic: if extraction created a single directory, descend into it for origin path
  const entries = await fsp.readdir(destDir);
  if (entries.length === 1) {
    const only = path.join(destDir, entries[0]);
    const st = await fsp.stat(only).catch(() => null);
    if (st && st.isDirectory()) return only;
  }
  console.error("[patch-cpp] extract: done");
  return destDir;
}

export async function ensureOriginAndWorkspace(
  attr: string,
  pre?: { pname: string; version: string; srcPath: string },
): Promise<{
  key: string;
  originPath: string;
  workspacePath: string;
  version: string;
  pname: string;
}> {
  const attrNorm = normalizeNixAttr(attr);
  const { pname, version, srcPath } = pre || (await resolveNixpkg(attrNorm));
  const key = `${attrNorm}@${version}`.toLowerCase();
  const safeKey = encodeNixAttrForPatchPrefix(key);
  const base = path.join(os.tmpdir(), "viberoots-patch-cpp");
  await mkdirWithMacosMetadataExclusion(base);
  const originRoot = await fsp.mkdtemp(path.join(base, `origin-${safeKey}-`));
  const wsRoot = await fsp.mkdtemp(path.join(base, `ws-${safeKey}-`));
  await Promise.all([markMacosMetadataNeverIndex(originRoot), markMacosMetadataNeverIndex(wsRoot)]);
  const originPath = await extractOrCopySrc(srcPath, originRoot);
  // Create workspace by cloning originPath
  await copyTree(originPath, wsRoot, { cloneMode: "try", force: true });
  await chmodRecursive(wsRoot);
  dbg("ensureOriginAndWorkspace", { attr: attrNorm, originRoot, wsRoot, version, pname });
  return { key, originPath, workspacePath: wsRoot, version, pname };
}
