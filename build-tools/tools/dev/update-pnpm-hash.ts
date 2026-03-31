#!/usr/bin/env zx-wrapper
import path from "node:path";
import { flakeRefForImporter } from "./install/common.ts";
import { withExclusiveInstallLock } from "./install/lock.ts";
import { newManagedCommandActivity } from "./update-pnpm-hash/activity.ts";
import { withHeartbeat } from "./update-pnpm-hash/heartbeat.ts";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args.ts";
import {
  readNodeModulesHashForLockfile,
  updateNodeModulesHashesJson,
} from "./update-pnpm-hash/hashes-json.ts";
import {
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  withExactPrefetchedStore,
} from "./update-pnpm-hash/lockfile.ts";
import { handleNonDefaultImporter } from "./update-pnpm-hash/nondefault.ts";
import { buildStore, buildUnfixedAndHash, extractHash } from "./update-pnpm-hash/nix.ts";
import {
  installLockKeyForImporter,
  normalizeImporter,
  pnpmStoreAttrFromImporter,
  pnpmStoreUnfixedAttrFromImporter,
  repoRelativeLockfilePath,
} from "./update-pnpm-hash/paths.ts";
import {
  currentVerifiedMarkerFingerprint,
  persistVerifiedHash,
  readVerifiedMarker,
  restoreHashFromSharedCache,
  sha256File,
  verifiedMarkerPath,
} from "./update-pnpm-hash/verified-marker.ts";

async function inner() {
  const { lockfile, force } = parseUpdatePnpmHashArgs();
  const repoRoot = process.cwd();
  const relLock = repoRelativeLockfilePath(repoRoot, lockfile);
  const importer = normalizeImporter(path.posix.dirname(relLock));
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const unfixedAttr = pnpmStoreUnfixedAttrFromImporter(importer);
  const flakeRef = flakeRefForImporter(repoRoot, importer);
  const nonDefaultImporter = normalizeImporter(importer) !== ".";
  const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
  const lockAbs = path.join(repoRoot, relLock);
  const markerPath = verifiedMarkerPath(repoRoot, importer);
  const builderFingerprint = await currentVerifiedMarkerFingerprint(repoRoot);
  const key = relLock;
  if (force) {
    await updateNodeModulesHashesJson(key, "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  }
  const existingHash = await readNodeModulesHashForLockfile(key);
  const hasValidExistingHash =
    !force &&
    !!existingHash &&
    existingHash !== "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  await ensureImporterLockfileFreshIfAllowed({ repoRoot, importer });
  const existingLockHash = await sha256File(lockAbs);
  const existingMarker = await readVerifiedMarker(markerPath);
  const runFixedBuild = async (phaseLabel: string) =>
    await withExactPrefetchedStore({ repoRoot, importer }, async (extraEnv) => {
      const activity = newManagedCommandActivity();
      return await withHeartbeat(phaseLabel, buildStore(storeAttr, flakeRef, activity, extraEnv), {
        activity,
      });
    });
  const runUnfixedBuild = async (phaseLabel: string) =>
    await withExactPrefetchedStore({ repoRoot, importer }, async (extraEnv) => {
      const activity = newManagedCommandActivity();
      return await withHeartbeat(
        phaseLabel,
        buildUnfixedAndHash(unfixedAttr, flakeRef, activity, extraEnv),
        { activity },
      );
    });

  if (
    await handleNonDefaultImporter({
      importer,
      key,
      repoRoot,
      builderFingerprint,
      storeAttr,
      unfixedAttr,
      timeoutSec,
      markerPath,
      hasValidExistingHash,
      existingHash,
      existingLockHash,
      existingMarker,
      runFixedBuild,
      runUnfixedBuild,
    })
  ) {
    return;
  }
  if (!nonDefaultImporter && hasValidExistingHash) {
    const marker = existingMarker;
    if (
      existingLockHash &&
      marker &&
      marker.importer === importer &&
      marker.lockfile === key &&
      marker.lockHash === existingLockHash &&
      marker.hashValue === existingHash &&
      marker.builderFingerprint === builderFingerprint
    ) {
      await persistVerifiedHash({
        repoRoot,
        markerPath,
        marker: {
          importer,
          lockfile: key,
          lockHash: existingLockHash,
          hashValue: existingHash,
          builderFingerprint,
        },
      });
      console.log(
        `[update-pnpm-hash] importer=${importer} step=skip-root-marker attr=${storeAttr} lockfile=${key}`,
      );
      return;
    }
  }
  if (
    !nonDefaultImporter &&
    existingLockHash &&
    (await restoreHashFromSharedCache({
      repoRoot,
      key,
      markerPath,
      importer,
      storeAttr,
      builderFingerprint,
      existingLockHash,
      existingHash,
      hasValidExistingHash,
    }))
  ) {
    return;
  }
  // Fast strict path: verify fixed-output store first. Only compute unfixed hash when needed.
  console.log(
    `[update-pnpm-hash] importer=${importer} step=fixed-build attr=${storeAttr} timeout=${timeoutSec}s`,
  );
  let verify = await runFixedBuild(`importer=${importer} step=fixed-build attr=${storeAttr}`);
  if (verify.ok) {
    if (!nonDefaultImporter && hasValidExistingHash) {
      const lockHash = existingLockHash;
      if (lockHash) {
        await persistVerifiedHash({
          repoRoot,
          markerPath,
          marker: {
            importer,
            lockfile: key,
            lockHash,
            hashValue: existingHash,
            builderFingerprint,
          },
        });
      }
    }
    console.log("pnpm-store:", storeAttr, "hash updated and build succeeded");
    return;
  }
  if (/does not provide attribute/.test(String(verify.output || ""))) {
    console.warn(`[update-pnpm-hash] skip: flake attr missing (${storeAttr}); continuing`);
    return;
  }
  let suggested = extractHash(verify.output || "");
  if (!suggested) {
    console.log(
      `[update-pnpm-hash] importer=${importer} step=unfixed-build attr=${unfixedAttr} timeout=${timeoutSec}s`,
    );
    let pre = await runUnfixedBuild(`importer=${importer} step=unfixed-build attr=${unfixedAttr}`);
    if (!pre.ok) {
      await generateImporterLockfile({ repoRoot, importer });
      console.log(
        `[update-pnpm-hash] importer=${importer} step=unfixed-build-retry attr=${unfixedAttr} timeout=${timeoutSec}s`,
      );
      pre = await runUnfixedBuild(
        `importer=${importer} step=unfixed-build-retry attr=${unfixedAttr}`,
      );
    }
    if (pre.ok && pre.sri) {
      suggested = pre.sri;
    }
  }
  if (!suggested) {
    throw new Error(
      "pnpm-store still failing and no suggested hash found\n\n" + (verify.output || ""),
    );
  }
  const nextHash: string = suggested;
  await updateNodeModulesHashesJson(key, nextHash);
  console.log(
    `[update-pnpm-hash] importer=${importer} step=fixed-build-after-hash attr=${storeAttr} timeout=${timeoutSec}s`,
  );
  verify = await runFixedBuild(
    `importer=${importer} step=fixed-build-after-hash attr=${storeAttr}`,
  );
  if (!verify.ok) {
    console.error("pnpm-store still failing after hash update\n\n" + verify.output);
    process.exit(1);
  }
  if (!nonDefaultImporter) {
    const lockHash = existingLockHash;
    if (lockHash) {
      await persistVerifiedHash({
        repoRoot,
        markerPath,
        marker: {
          importer,
          lockfile: key,
          lockHash,
          hashValue: nextHash,
          builderFingerprint,
        },
      });
    }
  }
  console.log("pnpm-store:", storeAttr, "hash updated and build succeeded");
}

async function main() {
  if (String(process.env.INSTALL_LOCK_SKIP || "").trim() === "1") {
    return inner();
  }
  const { lockfile } = parseUpdatePnpmHashArgs();
  const installLockKey = installLockKeyForImporter(
    normalizeImporter(path.posix.dirname(repoRelativeLockfilePath(process.cwd(), lockfile))),
  );
  const lockScopeRaw = String(process.env.WORKSPACE_ROOT || process.env.REPO_ROOT || "").trim();
  const lockScopeRoot =
    lockScopeRaw && path.isAbsolute(lockScopeRaw) ? path.resolve(lockScopeRaw) : undefined;
  await withExclusiveInstallLock(installLockKey, inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockScopeRoot,
  });
}
void main().catch((e) => (console.error(e), process.exit(1)));
