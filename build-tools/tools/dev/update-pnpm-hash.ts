#!/usr/bin/env zx-wrapper
import path from "node:path";
import { flakeRefForImporter } from "./install/common";
import { withExclusiveInstallLock } from "./install/lock";
import { newManagedCommandActivity } from "./update-pnpm-hash/activity";
import { withHeartbeat } from "./update-pnpm-hash/heartbeat";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args";
import { withPnpmStoreBuildFlakeRef } from "./update-pnpm-hash/build-flake";
import * as hashesJson from "./update-pnpm-hash/hashes-json";
import {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  withExactPrefetchedStore,
  withResolvedExactPrefetchedStore,
} from "./update-pnpm-hash/lockfile";
import { handleNonDefaultImporter } from "./update-pnpm-hash/nondefault";
import { buildStore, buildUnfixedAndHash, extractHash } from "./update-pnpm-hash/nix";
import {
  installLockKeyForImporter,
  normalizeImporter,
  pnpmStoreAttrFromImporter,
  pnpmStoreUnfixedAttrFromImporter,
  repoRelativeLockfilePath,
} from "./update-pnpm-hash/paths";
import * as verifiedMarker from "./update-pnpm-hash/verified-marker";
import { findRepoRoot } from "../lib/repo";

async function inner() {
  const { lockfile, force, readOnly } = parseUpdatePnpmHashArgs();
  const repoRoot = await findRepoRoot(process.cwd());
  const relLock = repoRelativeLockfilePath(repoRoot, lockfile);
  const importer = normalizeImporter(path.posix.dirname(relLock));
  const hashKey = importer === "viberoots" ? "pnpm-lock.yaml" : relLock;
  const hashOwner = importer === "viberoots" ? "viberoots" : undefined;
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const unfixedAttr = pnpmStoreUnfixedAttrFromImporter(importer);
  const flakeRef = flakeRefForImporter(repoRoot, importer);
  const nonDefaultImporter = normalizeImporter(importer) !== ".";
  const timeoutSec = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim();
  const lockAbs = path.join(repoRoot, relLock);
  const markerPath = verifiedMarker.verifiedMarkerPath(repoRoot, importer);
  const builderFingerprint = await verifiedMarker.currentVerifiedMarkerFingerprint(
    repoRoot,
    importer,
  );
  const sharedCacheBuilderFingerprint =
    await verifiedMarker.currentSharedPnpmStoreHashCacheFingerprint(repoRoot, importer);
  const acceptedBuilderFingerprints =
    await verifiedMarker.currentVerifiedMarkerFingerprintCandidates(repoRoot, importer);
  const key = hashKey;
  const placeholderHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const failReadOnly = (detail: string): never => {
    throw new Error(
      [
        `pnpm hash metadata is stale for ${key}`,
        detail,
        "repair: viberoots update",
        `or: zx-wrapper viberoots/build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${relLock}`,
      ].join("\n"),
    );
  };
  if (force && readOnly) {
    throw new Error("update-pnpm-hash --read-only cannot be combined with --force");
  }
  if (force)
    await hashesJson.updateNodeModulesHashesJson(key, placeholderHash, {
      owner: hashOwner,
      root: repoRoot,
    });
  const existingHash = await hashesJson.readNodeModulesHashForLockfile(key, {
    owner: hashOwner,
    root: repoRoot,
  });
  const hasValidExistingHash = !force && !!existingHash && existingHash !== placeholderHash;
  if (nonDefaultImporter) {
    if (!readOnly) await ensureImporterLockfileFresh({ repoRoot, importer });
  } else {
    if (!readOnly) await ensureImporterLockfileFreshIfAllowed({ repoRoot, importer });
  }
  const existingLockHash = await verifiedMarker.sha256File(lockAbs);
  const existingMarker = await verifiedMarker.readVerifiedMarker(markerPath);
  const marker = existingMarker;
  const markerMatchesCurrentBuilder =
    existingLockHash &&
    marker &&
    marker.importer === importer &&
    marker.lockfile === key &&
    marker.lockHash === existingLockHash &&
    marker.hashValue === existingHash &&
    acceptedBuilderFingerprints.includes(marker.builderFingerprint);
  const runFixedBuild = async (phaseLabel: string) =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) =>
        await withResolvedExactPrefetchedStore(
          { repoRoot, importer, flakeRef: buildFlakeRef, attrPath: storeAttr },
          async (extraEnv) => {
            const nixEnv = { ...extraEnv, ...filteredEnv };
            const activity = newManagedCommandActivity();
            return await withHeartbeat(
              phaseLabel,
              buildStore(storeAttr, buildFlakeRef, activity, nixEnv),
              { activity },
            );
          },
        ),
    );
  const runUnfixedBuild = async (phaseLabel: string) =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) =>
        await withExactPrefetchedStore({ repoRoot, importer }, async (extraEnv) => {
          const nixEnv = { ...extraEnv, ...filteredEnv };
          const activity = newManagedCommandActivity();
          return await withHeartbeat(
            phaseLabel,
            buildUnfixedAndHash(unfixedAttr, buildFlakeRef, activity, nixEnv),
            { activity },
          );
        }),
    );
  if (
    await handleNonDefaultImporter({
      importer,
      key,
      repoRoot,
      builderFingerprint,
      sharedCacheBuilderFingerprint,
      storeAttr,
      unfixedAttr,
      timeoutSec,
      force,
      readOnly,
      markerPath,
      hasValidExistingHash,
      existingHash,
      existingLockHash,
      existingMarker,
      acceptedBuilderFingerprints,
      hashOwner,
      runFixedBuild,
      runUnfixedBuild,
    })
  ) {
    return;
  }
  if (!nonDefaultImporter && hasValidExistingHash) {
    if (markerMatchesCurrentBuilder) {
      await verifiedMarker.persistVerifiedHash({
        repoRoot,
        markerPath,
        marker: {
          importer,
          lockfile: key,
          lockHash: existingLockHash,
          hashValue: existingHash,
          builderFingerprint,
        },
        sharedCacheBuilderFingerprint,
      });
      console.log(
        `[update-pnpm-hash] importer=${importer} step=skip-root-marker attr=${storeAttr} lockfile=${key}`,
      );
      return;
    }
  }
  if (
    !readOnly &&
    !nonDefaultImporter &&
    existingLockHash &&
    (await verifiedMarker.restoreHashFromSharedCache({
      repoRoot,
      key,
      markerPath,
      importer,
      storeAttr,
      builderFingerprint,
      sharedCacheBuilderFingerprint,
      existingLockHash,
      existingHash,
      hasValidExistingHash,
      hashOwner,
      hashRoot: repoRoot,
    }))
  ) {
    return;
  }
  if (
    !nonDefaultImporter &&
    hasValidExistingHash &&
    existingMarker &&
    !markerMatchesCurrentBuilder
  ) {
    console.log(
      `[update-pnpm-hash] importer=${importer} step=stale-builder-recompute attr=${unfixedAttr} timeout=${timeoutSec}s`,
    );
    let pre = await runUnfixedBuild(
      `importer=${importer} step=stale-builder-recompute attr=${unfixedAttr}`,
    );
    if (!pre.ok) {
      await generateImporterLockfile({ repoRoot, importer });
      console.log(
        `[update-pnpm-hash] importer=${importer} step=stale-builder-recompute-retry attr=${unfixedAttr} timeout=${timeoutSec}s`,
      );
      pre = await runUnfixedBuild(
        `importer=${importer} step=stale-builder-recompute-retry attr=${unfixedAttr}`,
      );
    }
    if (!pre.ok || !pre.sri) {
      throw new Error(
        "pnpm-store-unfixed failed during stale builder recompute\n\n" + String(pre.output || ""),
      );
    }
    const nextHash = pre.sri;
    await hashesJson.updateNodeModulesHashesJson(key, nextHash, {
      owner: hashOwner,
      root: repoRoot,
    });
    console.log(
      `[update-pnpm-hash] importer=${importer} step=stale-builder-fixed-after-hash attr=${storeAttr} timeout=${timeoutSec}s`,
    );
    const verifyAfterHash = await runFixedBuild(
      `importer=${importer} step=stale-builder-fixed-after-hash attr=${storeAttr}`,
    );
    if (!verifyAfterHash.ok) {
      throw new Error(
        "pnpm-store still failing after stale builder hash update\n\n" +
          String(verifyAfterHash.output || ""),
      );
    }
    const lockHash = existingLockHash;
    if (lockHash) {
      await verifiedMarker.persistVerifiedHash({
        repoRoot,
        markerPath,
        marker: {
          importer,
          lockfile: key,
          lockHash,
          hashValue: nextHash,
          builderFingerprint,
        },
        sharedCacheBuilderFingerprint,
      });
    }
    console.log("pnpm-store:", storeAttr, "hash updated and build succeeded");
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
        await verifiedMarker.persistVerifiedHash({
          repoRoot,
          markerPath,
          marker: {
            importer,
            lockfile: key,
            lockHash,
            hashValue: existingHash,
            builderFingerprint,
          },
          sharedCacheBuilderFingerprint,
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
  if (readOnly && suggested) {
    failReadOnly(`${existingHash || "(missing)"} -> ${suggested}`);
  }
  if (readOnly && !suggested) {
    failReadOnly("fixed pnpm-store build failed without a suggested replacement hash");
  }
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
  if (readOnly) {
    failReadOnly(`${existingHash || "(missing)"} -> ${nextHash}`);
  }
  await hashesJson.updateNodeModulesHashesJson(key, nextHash, {
    owner: hashOwner,
    root: repoRoot,
  });
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
      await verifiedMarker.persistVerifiedHash({
        repoRoot,
        markerPath,
        marker: {
          importer,
          lockfile: key,
          lockHash,
          hashValue: nextHash,
          builderFingerprint,
        },
        sharedCacheBuilderFingerprint,
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
void main().catch(
  (e) => (console.error(e instanceof Error ? e.message : String(e)), process.exit(1)),
);
