#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool } from "../../lib/cli.ts";
import { writeIfChanged } from "../../lib/fs-helpers.ts";
import { resolveImporterDir } from "../../lib/lockfiles.ts";
import { pathExists, repoRoot } from "../../lib/repo.ts";
import { sanitizeName } from "./common.ts";

export async function relinkNodeModules(force: boolean) {
  const root = repoRoot();
  const cwd = path.resolve(process.cwd());
  const importer = await resolveImporterDir(process.cwd()).catch(() => "."); // POSIX repo-relative
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
  const existsNm = await pathExists(nm);
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
  if (cwd === root && importer === ".") {
    const lockRel = "pnpm-lock.yaml";
    const lockAbs = path.join(root, lockRel);
    const hasLock = await pathExists(lockAbs);
    if (hasLock) {
      const buf = await fsp.readFile(lockAbs);
      const lockHash = crypto.createHash("sha256").update(buf).digest("hex");
      const markerPath = path.join(root, "buck-out", "tmp", "node-modules-link.json");
      const marker = {
        importer,
        lockfile: lockRel,
        lockHash,
        outPath,
      };
      await fsp.mkdir(path.dirname(markerPath), { recursive: true }).catch(() => {});
      await writeIfChanged(markerPath, JSON.stringify(marker, null, 2) + "\n");
    }
  }
}

async function main(): Promise<void> {
  const force = getFlagBool("force");
  await relinkNodeModules(force);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
