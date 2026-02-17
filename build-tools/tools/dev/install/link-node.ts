#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool } from "../../lib/cli.ts";
import { writeIfChanged } from "../../lib/fs-helpers.ts";
import { resolveImporterDir } from "../../lib/lockfiles.ts";
import { activeNixGcPids, nixGcLockMessage } from "../../lib/nix-gc-lock.ts";
import { type ManagedCommandActivity, runManagedCommand } from "../../lib/managed-command.ts";
import { pathExists, repoRoot } from "../../lib/repo.ts";
import { makeFilteredFlakeRef } from "../update-pnpm-hash/lockfile.ts";
import { flakeRefForImporter, sanitizeName } from "./common.ts";
import {
  ensureNodeModulesGcRoot,
  failOnCompetingBuilds,
  recoverOutPathFromExistingSymlink,
  withHeartbeat,
} from "./link-node-helpers.ts";

export async function relinkNodeModules(force: boolean) {
  const root = repoRoot();
  const cwd = path.resolve(process.cwd());
  const importer = await resolveImporterDir(process.cwd()).catch(() => "."); // POSIX repo-relative
  const attr = !importer || importer === "." ? "default" : sanitizeName(importer);
  let outPath = "";
  const flakeRoot = (process.env.WORKSPACE_ROOT || process.cwd()).trim();
  const timeoutSec =
    Number.parseInt(String(process.env.NIX_PNPM_FETCH_TIMEOUT || "180"), 10) || 180;
  const nixBuildTimeoutMs = timeoutSec * 1000 + 10000;
  const isDefaultImporter = !importer || importer === ".";
  const lockRel = isDefaultImporter ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
  const lockAbs = path.join(root, lockRel);
  const nm = path.join(process.cwd(), "node_modules");
  const markerKey = isDefaultImporter ? "root" : sanitizeName(importer);
  const markerPath = path.join(root, "buck-out", "tmp", `node-modules-link.${markerKey}.json`);
  {
    try {
      const [lockBuf, markerRaw] = await Promise.all([
        fsp.readFile(lockAbs).catch(() => null),
        fsp.readFile(markerPath, "utf8").catch(() => ""),
      ]);
      if (lockBuf && markerRaw) {
        const marker = JSON.parse(markerRaw) as {
          importer?: string;
          lockfile?: string;
          lockHash?: string;
          outPath?: string;
        };
        const lockHash = crypto.createHash("sha256").update(lockBuf).digest("hex");
        const markerTarget = String(marker.outPath || "").trim();
        const markerNodeModules = markerTarget ? path.join(markerTarget, "node_modules") : "";
        const hasMarkerTarget = markerNodeModules ? await pathExists(markerNodeModules) : false;
        let symlinkMatches = false;
        try {
          const st = await fsp.lstat(nm);
          symlinkMatches = st.isSymbolicLink() && (await fsp.readlink(nm)) === markerNodeModules;
        } catch {}
        if (
          marker.importer === importer &&
          marker.lockfile === lockRel &&
          marker.lockHash === lockHash &&
          hasMarkerTarget
        ) {
          outPath = markerTarget;
          if (!symlinkMatches) {
            console.error(
              "[link-node] marker target valid; node_modules symlink will be corrected",
              importer,
            );
          }
          console.error("[link-node] using marker fast-path for importer", importer, outPath);
        }
      }
    } catch {}
  }
  if (!outPath) {
    const recovered = await recoverOutPathFromExistingSymlink(nm, lockAbs);
    if (recovered) {
      outPath = recovered.outPath;
      console.error(
        "[link-node] recovered outPath from existing symlink for importer",
        importer,
        outPath,
      );
    }
  }
  const flakeRef = flakeRefForImporter(flakeRoot, importer);
  let tempFlake: { flakeRef: string; cleanup: () => Promise<void> } | null = null;
  let buildFlakeRefBase = flakeRef;
  if (!outPath && attr) {
    try {
      if (!isDefaultImporter) {
        console.error("[link-node] preparing filtered flake snapshot for importer", importer);
        tempFlake = await withHeartbeat(
          `importer=${importer} step=prepare-filtered-flake`,
          makeFilteredFlakeRef(root),
        );
        buildFlakeRefBase = tempFlake.flakeRef.replace(/#pnpm$/, "");
      }
      const gcPids = activeNixGcPids();
      if (gcPids.length > 0) {
        throw new Error(nixGcLockMessage("[link-node] nix build", gcPids));
      }
      failOnCompetingBuilds(attr);
      console.error(
        "[link-node] building nix attr",
        `node-modules.${attr}`,
        "from",
        buildFlakeRefBase,
      );
      const activity: ManagedCommandActivity = {
        startedAtMs: Date.now(),
        lastOutputAtMs: 0,
        lastEventSnippet: "",
        stdoutBytes: 0,
        stderrBytes: 0,
      };
      const built = await withHeartbeat(
        `importer=${importer} step=build attr=node-modules.${attr}`,
        runManagedCommand({
          command: "nix",
          args: [
            "build",
            `${buildFlakeRefBase}#node-modules.${attr}`,
            "--no-link",
            "--accept-flake-config",
            "--option",
            "min-free",
            "0",
            "--option",
            "max-free",
            "0",
            "--print-out-paths",
          ],
          cwd: root,
          env: process.env,
          timeoutMs: nixBuildTimeoutMs,
          activity,
        }),
        { activity },
      );
      if (!built.ok) {
        const output = String(built.stdout || "") + String(built.stderr || "");
        throw new Error(
          `[link-node] timed out/failed building node-modules.${attr} for importer '${importer}' after ${timeoutSec}s: ${output}`,
        );
      }
      outPath =
        String(built.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
    } finally {
      if (tempFlake) await tempFlake.cleanup();
    }
  }
  if (!outPath) {
    throw new Error(
      `[link-node] failed to resolve outPath for importer '${importer}' attr node-modules.${attr}`,
    );
  }
  await ensureNodeModulesGcRoot(root, markerKey, outPath);
  try {
    console.error("[link-node] importer=", importer, " attr=", attr, " outPath=", outPath);
  } catch {}
  if (!outPath) return;
  const linkTarget = path.join(outPath, "node_modules");
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
  if (cwd === root || !isDefaultImporter) {
    const hasLock = await pathExists(lockAbs);
    if (hasLock) {
      const buf = await fsp.readFile(lockAbs);
      const lockHash = crypto.createHash("sha256").update(buf).digest("hex");
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
