#!/usr/bin/env zx-wrapper
import path from "node:path";
import { type ManagedCommandActivity } from "../lib/managed-command.ts";
import { flakeRefForImporter } from "./install/common.ts";
import { withExclusiveInstallLock } from "./install/lock.ts";
import { withHeartbeat } from "./update-pnpm-hash/heartbeat.ts";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args.ts";
import {
  readNodeModulesHashForLockfile,
  updateNodeModulesHashesJson,
} from "./update-pnpm-hash/hashes-json.ts";
import {
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  makeFilteredFlakeRef,
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
  readVerifiedMarker,
  sha256File,
  verifiedMarkerPath,
  writeVerifiedMarker,
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

  const key = relLock;
  if (force) {
    await updateNodeModulesHashesJson(key, "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  }
  const existingHash = await readNodeModulesHashForLockfile(key);
  const hasValidExistingHash =
    !force &&
    !!existingHash &&
    existingHash !== "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const existingLockHash = await sha256File(lockAbs);
  const existingMarker = await readVerifiedMarker(markerPath);

  await ensureImporterLockfileFreshIfAllowed({ repoRoot, importer });

  if (
    await handleNonDefaultImporter({
      importer,
      key,
      repoRoot,
      storeAttr,
      unfixedAttr,
      timeoutSec,
      markerPath,
      hasValidExistingHash,
      existingHash,
      existingLockHash,
      existingMarker,
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
      marker.hashValue === existingHash
    ) {
      console.log(
        `[update-pnpm-hash] importer=${importer} step=skip-root-marker attr=${storeAttr} lockfile=${key}`,
      );
      return;
    }
  }

  // Fast strict path: verify fixed-output store first. Only compute unfixed hash when needed.
  console.log(
    `[update-pnpm-hash] importer=${importer} step=fixed-build attr=${storeAttr} timeout=${timeoutSec}s`,
  );
  const fixedActivity: ManagedCommandActivity = {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  let verify = await withHeartbeat(
    `importer=${importer} step=fixed-build attr=${storeAttr}`,
    buildStore(storeAttr, flakeRef, fixedActivity),
    { activity: fixedActivity },
  );
  if (verify.ok) {
    if (!nonDefaultImporter && hasValidExistingHash) {
      const lockHash = existingLockHash;
      if (lockHash) {
        await writeVerifiedMarker(markerPath, {
          importer,
          lockfile: key,
          lockHash,
          hashValue: existingHash,
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
    let tempFlake: { flakeRef: string; cleanup: () => Promise<void> } | null = null;
    try {
      if (nonDefaultImporter) {
        console.log(
          `[update-pnpm-hash] importer=${importer} step=prepare-filtered-flake attr=${unfixedAttr}`,
        );
      }
      tempFlake = nonDefaultImporter
        ? await withHeartbeat(
            `importer=${importer} step=prepare-filtered-flake attr=${unfixedAttr}`,
            makeFilteredFlakeRef(repoRoot),
          )
        : null;
      const prewarmFlakeRef = tempFlake ? tempFlake.flakeRef.replace(/#pnpm$/, "") : flakeRef;
      console.log(
        `[update-pnpm-hash] importer=${importer} step=unfixed-build attr=${unfixedAttr} timeout=${timeoutSec}s`,
      );
      const unfixedActivity: ManagedCommandActivity = {
        startedAtMs: Date.now(),
        lastOutputAtMs: 0,
        lastEventSnippet: "",
        stdoutBytes: 0,
        stderrBytes: 0,
      };
      let pre = await withHeartbeat(
        `importer=${importer} step=unfixed-build attr=${unfixedAttr}`,
        buildUnfixedAndHash(unfixedAttr, prewarmFlakeRef, unfixedActivity),
        { activity: unfixedActivity },
      );
      if (!pre.ok) {
        await generateImporterLockfile({ repoRoot, importer });
        console.log(
          `[update-pnpm-hash] importer=${importer} step=unfixed-build-retry attr=${unfixedAttr} timeout=${timeoutSec}s`,
        );
        const retryActivity: ManagedCommandActivity = {
          startedAtMs: Date.now(),
          lastOutputAtMs: 0,
          lastEventSnippet: "",
          stdoutBytes: 0,
          stderrBytes: 0,
        };
        pre = await withHeartbeat(
          `importer=${importer} step=unfixed-build-retry attr=${unfixedAttr}`,
          buildUnfixedAndHash(unfixedAttr, prewarmFlakeRef, retryActivity),
          { activity: retryActivity },
        );
      }
      if (pre.ok && pre.sri) {
        suggested = pre.sri;
      }
    } finally {
      if (tempFlake) {
        await tempFlake.cleanup();
      }
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
  const fixedAfterActivity: ManagedCommandActivity = {
    startedAtMs: Date.now(),
    lastOutputAtMs: 0,
    lastEventSnippet: "",
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  verify = await withHeartbeat(
    `importer=${importer} step=fixed-build-after-hash attr=${storeAttr}`,
    buildStore(storeAttr, flakeRef, fixedAfterActivity),
    { activity: fixedAfterActivity },
  );
  if (!verify.ok) {
    console.error("pnpm-store still failing after hash update\n\n" + verify.output);
    process.exit(1);
  }
  if (!nonDefaultImporter) {
    const lockHash = existingLockHash;
    if (lockHash) {
      await writeVerifiedMarker(markerPath, {
        importer,
        lockfile: key,
        lockHash,
        hashValue: nextHash,
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
  const lockScopeRaw = String(process.env.REPO_ROOT || process.env.WORKSPACE_ROOT || "").trim();
  const lockScopeRoot =
    lockScopeRaw && path.isAbsolute(lockScopeRaw) ? path.resolve(lockScopeRaw) : undefined;
  await withExclusiveInstallLock(installLockKey, inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    scopeRootAbs: lockScopeRoot,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
