import * as fsp from "node:fs/promises";
import path from "node:path";
import { repoRoot, pathExists } from "../../../lib/repo.ts";

let cachedSource: Promise<{ bzl: string; json: string } | null> | null = null;

function resolveSourceRoot(): string {
  const envRoot = String(process.env.REPO_ROOT || process.env.LIVE_ROOT || "").trim();
  return envRoot || repoRoot();
}

async function ensureSourceFiles($: any): Promise<{ bzl: string; json: string }> {
  if (!cachedSource) {
    cachedSource = (async () => {
      const root = resolveSourceRoot();
      const bzl = path.join(root, "toolchains", "toolchain_paths.bzl");
      const json = path.join(root, "build-tools", "tools", "dev", "toolchain-paths.json");
      if (!(await pathExists(bzl)) || !(await pathExists(json))) {
        await $({
          cwd: root,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/dev/gen-toolchain-paths.ts`;
      }
      if (!(await pathExists(bzl)) || !(await pathExists(json))) {
        throw new Error("toolchain paths generation failed");
      }
      return { bzl, json };
    })();
  }
  const out = await cachedSource;
  if (!out) throw new Error("toolchain paths generation failed");
  return out;
}

async function copyIfMissing(src: string, dst: string): Promise<void> {
  if (await pathExists(dst)) return;
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
}

export async function ensureToolchainPathsForTempRepo(tmp: string, $: any): Promise<void> {
  const src = await ensureSourceFiles($);
  const bzlDst = path.join(tmp, "toolchains", "toolchain_paths.bzl");
  const jsonDst = path.join(tmp, "build-tools", "tools", "dev", "toolchain-paths.json");
  await copyIfMissing(src.bzl, bzlDst);
  await copyIfMissing(src.json, jsonDst);
}
