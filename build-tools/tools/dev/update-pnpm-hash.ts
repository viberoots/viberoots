#!/usr/bin/env zx-wrapper
import path from "node:path";
import { flakeRefForImporter } from "./install/common";
import { withExclusiveInstallLock } from "./install/lock";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args";
import { withPnpmStoreBuildFlakeRef } from "./update-pnpm-hash/build-flake";
import { resolveUpdatePnpmHashCommandRoot } from "./update-pnpm-hash/command-root";
import { ensureExactStoreGcRoot } from "./update-pnpm-hash/exact-store-gc-root";
import { runPnpmStoreReconciliation } from "./update-pnpm-hash/fixed-store-reconcile";
import * as hashesJson from "./update-pnpm-hash/hashes-json";
import {
  assertImporterLockfileFresh,
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
} from "./update-pnpm-hash/importer-lockfile";
import {
  installLockKeyForImporter,
  normalizeImporter,
  pnpmStoreAttrFromImporter,
  repoRelativeLockfilePath,
} from "./update-pnpm-hash/paths";
import {
  evaluatePnpmStoreDerivationIdentity,
  inspectCommittedFinalPnpmStore,
  resolveFinalPnpmStore,
} from "./update-pnpm-hash/realized-store";
import * as verifiedMarker from "./update-pnpm-hash/verified-marker";
import {
  closeManagedCancellationChannel,
  initializeManagedCancellationChannel,
} from "../lib/managed-cancellation";

initializeManagedCancellationChannel();

const PLACEHOLDER_PNPM_STORE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function inner() {
  const { lockfile, force = false, readOnly = false } = parseUpdatePnpmHashArgs();
  if (force && readOnly) {
    throw new Error("update-pnpm-hash --read-only cannot be combined with --force");
  }

  const repoRoot = await resolveUpdatePnpmHashCommandRoot(process.cwd());
  const relLock = repoRelativeLockfilePath(repoRoot, lockfile);
  const importer = normalizeImporter(path.posix.dirname(relLock));
  const key = importer === "viberoots" ? "pnpm-lock.yaml" : relLock;
  const hashOwner = hashesJson.hashOwnerForLockfile(key, repoRoot, importer);
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const flakeRef = flakeRefForImporter(repoRoot, importer);
  const lockAbs = path.join(repoRoot, relLock);
  const markerPath = verifiedMarker.verifiedMarkerPath(repoRoot, importer);

  if (readOnly) {
    await assertImporterLockfileFresh({ repoRoot, importer });
  } else if (importer === ".") {
    if (!readOnly) await ensureImporterLockfileFreshIfAllowed({ repoRoot, importer });
  } else if (!readOnly) {
    await ensureImporterLockfileFresh({ repoRoot, importer });
  }

  const lockHash = await verifiedMarker.sha256File(lockAbs);
  const currentHash = await hashesJson.readNodeModulesHashForLockfile(key, {
    owner: hashOwner,
    root: repoRoot,
  });
  const builderFingerprint = await verifiedMarker.currentVerifiedMarkerFingerprint(
    repoRoot,
    importer,
  );
  const sharedCacheBuilderFingerprint =
    await verifiedMarker.currentSharedPnpmStoreHashCacheFingerprint(repoRoot, importer);
  const acceptedBuilderFingerprints =
    await verifiedMarker.currentVerifiedMarkerFingerprintCandidates(repoRoot, importer);
  const marker = await verifiedMarker.readVerifiedMarker(markerPath);
  const markerMetadataMatches = Boolean(
    currentHash &&
      marker &&
      marker.importer === importer &&
      marker.lockfile === key &&
      marker.lockHash === lockHash &&
      marker.hashValue === currentHash &&
      acceptedBuilderFingerprints.includes(marker.builderFingerprint),
  );

  const probe = async (): Promise<{ fixedStorePath: string; derivationIdentity: string }> =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) => {
        const env = { ...process.env, ...filteredEnv };
        const resolved = await resolveFinalPnpmStore({
          repoRoot,
          importer,
          flakeRef: buildFlakeRef,
          attrPath: storeAttr,
          env,
        });
        const derivationIdentity = await evaluatePnpmStoreDerivationIdentity({
          repoRoot,
          flakeRef: buildFlakeRef,
          attrPath: storeAttr,
          env,
        });
        await ensureExactStoreGcRoot({
          repoRoot,
          importer,
          storePath: resolved.fixedStorePath,
          mode: readOnly ? "read-only" : "reconcile",
          env,
        });
        return { fixedStorePath: resolved.fixedStorePath, derivationIdentity };
      },
    );

  const inspectForRebuild = async (): Promise<"realized" | "absent" | "invalid"> =>
    await withPnpmStoreBuildFlakeRef(
      { repoRoot, importer, baseFlakeRef: flakeRef },
      async (buildFlakeRef, filteredEnv) =>
        (
          await inspectCommittedFinalPnpmStore({
            repoRoot,
            importer,
            flakeRef: buildFlakeRef,
            attrPath: storeAttr,
            env: { ...process.env, ...filteredEnv },
          })
        ).status,
    );

  if (readOnly) {
    if (!currentHash || currentHash === PLACEHOLDER_PNPM_STORE_HASH) {
      throw new Error(`pnpm hash metadata is stale for ${importer}; repair: run u`);
    }
    const initialStatus = await inspectForRebuild();
    if (initialStatus === "invalid") {
      throw new Error(`committed pnpm store is invalid for ${importer}; repair: run u`);
    }
    if (initialStatus === "absent")
      throw new Error(
        `final pnpm store is not realized for ${importer}; no tracked files were modified\nrepair: run u`,
      );
    const realized = await probe();
    await verifiedMarker.writeVerifiedMarker(markerPath, {
      importer,
      lockfile: key,
      lockHash,
      hashValue: currentHash,
      builderFingerprint,
      derivationIdentity: realized.derivationIdentity,
    });
    console.log(`pnpm-store: ${storeAttr} is realized from committed metadata`);
    return;
  }

  await runPnpmStoreReconciliation({
    repoRoot,
    importer,
    flakeRef,
    storeAttr,
    lockHash,
    key,
    hashOwner,
    markerPath,
    currentHash,
    force,
    markerMetadataMatches,
    marker,
    builderFingerprint,
    sharedCacheBuilderFingerprint,
    probe,
    inspectForRebuild,
  });
}

async function main() {
  if (String(process.env.INSTALL_LOCK_SKIP || "").trim() === "1") return await inner();
  const { lockfile } = parseUpdatePnpmHashArgs();
  const commandRoot = await resolveUpdatePnpmHashCommandRoot(process.cwd());
  const installLockKey = installLockKeyForImporter(
    normalizeImporter(path.posix.dirname(repoRelativeLockfilePath(commandRoot, lockfile))),
  );
  const lockScopeRaw = String(process.env.WORKSPACE_ROOT || process.env.REPO_ROOT || "").trim();
  const lockScopeRoot =
    lockScopeRaw && path.isAbsolute(lockScopeRaw) ? path.resolve(lockScopeRaw) : commandRoot;
  await withExclusiveInstallLock(installLockKey, inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockScopeRoot,
  });
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closeManagedCancellationChannel);
