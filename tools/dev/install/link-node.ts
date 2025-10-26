#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "./common.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function findNearestImporter(): string {
  let here = process.cwd();
  const envRoot = (process.env.WORKSPACE_ROOT || "").trim();
  const root = envRoot ? path.resolve(envRoot) : here;
  while (true) {
    const lock = path.join(here, "pnpm-lock.yaml");
    const rel = path.relative(root, here) || ".";
    const looksImporter = rel.startsWith("apps/") || rel.startsWith("libs/");
    if (looksImporter) {
      return rel;
    }
    const next = path.dirname(here);
    if (next === here) break;
    here = next;
  }
  // Fallback to default/root importer when no apps/libs importer is found
  return ".";
}

export async function relinkNodeModules(force: boolean) {
  const importer = findNearestImporter();
  const attr = !importer || importer === "." ? "default" : sanitizeName(importer);
  let outPath = "";
  const flakeRoot = (process.env.WORKSPACE_ROOT || process.cwd()).trim();
  if (attr) {
    const { stdout } =
      await $`nix eval --raw ${flakeRoot}#node-modules.${attr}.outPath --accept-flake-config`.nothrow();
    outPath = String(stdout).trim();
    if (!outPath) {
      // Build the attr and retry eval; if eval still fails (e.g., due to flake config),
      // fall back to capturing the out path via --print-out-paths.
      await $`nix build ${flakeRoot}#node-modules.${attr} --no-link --accept-flake-config`;
      const { stdout: s2 } =
        await $`nix eval --raw ${flakeRoot}#node-modules.${attr}.outPath --accept-flake-config`.nothrow();
      outPath = String(s2).trim();
      if (!outPath) {
        const { stdout: s3 } =
          await $`nix build ${flakeRoot}#node-modules.${attr} --no-link --accept-flake-config --print-out-paths`;
        outPath = String(s3).trim();
      }
    }
  }
  if (!outPath) {
    const { stdout } =
      await $`nix build ${flakeRoot}#node-modules.default --no-link --accept-flake-config --print-out-paths`;
    outPath = String(stdout).trim();
  }
  try {
    console.error("[link-node] importer=", importer, " attr=", attr, " outPath=", outPath);
  } catch {}
  if (!outPath) return;
  const linkTarget = path.join(outPath, "node_modules");
  const nm = path.join(process.cwd(), "node_modules");
  const existsNm = await exists(nm);
  if (existsNm && !(await fsp.lstat(nm)).isSymbolicLink()) {
    if (!force) {
      console.error("node_modules exists and is not a symlink. Use --force to replace.");
      process.exit(2);
    }
    await fsp.rm(nm, { recursive: true, force: true });
  }
  await fsp.symlink(linkTarget, nm).catch(async () => {
    await fsp.rm(nm, { recursive: true, force: true }).catch(() => {});
    await fsp.symlink(linkTarget, nm);
  });
  // Verify
  try {
    const st = await fsp.lstat(nm);
    console.error(
      "[link-node] linked node_modules ->",
      linkTarget,
      " isSymlink=",
      st.isSymbolicLink(),
    );
  } catch (e) {
    console.error("[link-node] FAILED to link node_modules to", linkTarget, e);
    process.exit(2);
  }
}
