import { type ManagedCommandActivity } from "../../lib/managed-command.ts";
import { flakeRefForImporter } from "../install/common.ts";
import { updateNodeModulesHashesJson } from "./hashes-json.ts";
import { withHeartbeat } from "./heartbeat.ts";
import { generateImporterLockfile } from "./lockfile.ts";
import { buildStore, buildUnfixedAndHash, extractHash } from "./nix.ts";
import { type PnpmStoreVerifiedMarker, writeVerifiedMarker } from "./verified-marker.ts";

const newActivity = (): ManagedCommandActivity => ({
  startedAtMs: Date.now(),
  lastOutputAtMs: 0,
  lastEventSnippet: "",
  stdoutBytes: 0,
  stderrBytes: 0,
});

export async function handleNonDefaultImporter(opts: {
  importer: string;
  key: string;
  repoRoot: string;
  builderFingerprint: string;
  storeAttr: string;
  unfixedAttr: string;
  timeoutSec: string;
  markerPath: string;
  hasValidExistingHash: boolean;
  existingHash: string;
  existingLockHash: string;
  existingMarker: PnpmStoreVerifiedMarker | null;
}): Promise<boolean> {
  if (opts.importer === ".") return false;
  const fixedFlakeRef = flakeRefForImporter(opts.repoRoot, opts.importer);
  const unfixedFlakeRef = fixedFlakeRef.replace(/#pnpm$/, "");
  let suggestedHash: string | null = null;
  if (opts.hasValidExistingHash) {
    if (
      opts.existingLockHash &&
      opts.existingMarker &&
      opts.existingMarker.importer === opts.importer &&
      opts.existingMarker.lockfile === opts.key &&
      opts.existingMarker.lockHash === opts.existingLockHash &&
      opts.existingMarker.hashValue === opts.existingHash &&
      opts.existingMarker.builderFingerprint === opts.builderFingerprint
    ) {
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=skip-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
      );
      return true;
    }
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=stale-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
    );
    const verifyExistingActivity = newActivity();
    const verifyExisting = await withHeartbeat(
      `importer=${opts.importer} step=fixed-build attr=${opts.storeAttr}`,
      buildStore(opts.storeAttr, fixedFlakeRef, verifyExistingActivity),
      { activity: verifyExistingActivity },
    );
    if (verifyExisting.ok) {
      if (opts.existingLockHash) {
        await writeVerifiedMarker(opts.markerPath, {
          importer: opts.importer,
          lockfile: opts.key,
          lockHash: opts.existingLockHash,
          hashValue: opts.existingHash,
          builderFingerprint: opts.builderFingerprint,
        });
      }
      console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
      return true;
    }
    if (/does not provide attribute/.test(String(verifyExisting.output || ""))) {
      console.warn(`[update-pnpm-hash] skip: flake attr missing (${opts.storeAttr}); continuing`);
      return true;
    }
    const suggestedFromExisting = extractHash(String(verifyExisting.output || ""));
    if (suggestedFromExisting) {
      await updateNodeModulesHashesJson(opts.key, suggestedFromExisting);
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
      );
      const verifyAfterActivity = newActivity();
      const verifyAfterHash = await withHeartbeat(
        `importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr}`,
        buildStore(opts.storeAttr, fixedFlakeRef, verifyAfterActivity),
        { activity: verifyAfterActivity },
      );
      if (!verifyAfterHash.ok) {
        console.error(
          "pnpm-store still failing after hash update\n\n" + String(verifyAfterHash.output || ""),
        );
        process.exit(1);
        return true;
      }
      if (opts.existingLockHash) {
        await writeVerifiedMarker(opts.markerPath, {
          importer: opts.importer,
          lockfile: opts.key,
          lockHash: opts.existingLockHash,
          hashValue: suggestedFromExisting,
          builderFingerprint: opts.builderFingerprint,
        });
      }
      console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
      return true;
    }
  }
  console.log(
    `[update-pnpm-hash] importer=${opts.importer} step=fixed-build attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
  );
  const fixedActivity = newActivity();
  const verify = await withHeartbeat(
    `importer=${opts.importer} step=fixed-build attr=${opts.storeAttr}`,
    buildStore(opts.storeAttr, fixedFlakeRef, fixedActivity),
    { activity: fixedActivity },
  );
  if (verify.ok) {
    if (opts.existingLockHash && opts.hasValidExistingHash) {
      await writeVerifiedMarker(opts.markerPath, {
        importer: opts.importer,
        lockfile: opts.key,
        lockHash: opts.existingLockHash,
        hashValue: opts.existingHash,
        builderFingerprint: opts.builderFingerprint,
      });
    }
    console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
    return true;
  }
  if (/does not provide attribute/.test(String(verify.output || ""))) {
    console.warn(`[update-pnpm-hash] skip: flake attr missing (${opts.storeAttr}); continuing`);
    return true;
  }
  suggestedHash = extractHash(String(verify.output || ""));
  if (!suggestedHash) {
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
    );
    const unfixedActivity = newActivity();
    let pre = await withHeartbeat(
      `importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr}`,
      buildUnfixedAndHash(opts.unfixedAttr, unfixedFlakeRef, unfixedActivity),
      { activity: unfixedActivity },
    );
    if (!pre.ok) {
      await generateImporterLockfile({ repoRoot: opts.repoRoot, importer: opts.importer });
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=unfixed-build-retry attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
      );
      const retryActivity = newActivity();
      pre = await withHeartbeat(
        `importer=${opts.importer} step=unfixed-build-retry attr=${opts.unfixedAttr}`,
        buildUnfixedAndHash(opts.unfixedAttr, unfixedFlakeRef, retryActivity),
        { activity: retryActivity },
      );
    }
    if (!pre.ok || !pre.sri) {
      console.error(
        "pnpm-store-unfixed failed and no SRI hash was produced\n\n" + String(pre.output || ""),
      );
      process.exit(1);
      return true;
    }
    suggestedHash = pre.sri;
  }
  const sri0 = suggestedHash;
  if (!sri0) {
    console.error("pnpm-store hash suggestion unexpectedly missing for non-default importer");
    process.exit(1);
    return true;
  }
  let sri = sri0;
  await updateNodeModulesHashesJson(opts.key, sri);
  console.log(
    `[update-pnpm-hash] importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
  );
  const verifyAfterActivity = newActivity();
  const verifyAfterHash = await withHeartbeat(
    `importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr}`,
    buildStore(opts.storeAttr, fixedFlakeRef, verifyAfterActivity),
    { activity: verifyAfterActivity },
  );
  if (!verifyAfterHash.ok) {
    const suggestedFromFixed = extractHash(String(verifyAfterHash.output || ""));
    if (suggestedFromFixed && suggestedFromFixed !== sri) {
      sri = suggestedFromFixed;
      await updateNodeModulesHashesJson(opts.key, sri);
      const retryAfterActivity = newActivity();
      const retryAfterHash = await withHeartbeat(
        `importer=${opts.importer} step=fixed-build-after-hash-retry attr=${opts.storeAttr}`,
        buildStore(opts.storeAttr, fixedFlakeRef, retryAfterActivity),
        { activity: retryAfterActivity },
      );
      if (!retryAfterHash.ok) {
        console.error(
          "pnpm-store still failing after hash update\n\n" + String(retryAfterHash.output || ""),
        );
        process.exit(1);
        return true;
      }
    } else {
      console.error(
        "pnpm-store still failing after hash update\n\n" + String(verifyAfterHash.output || ""),
      );
      process.exit(1);
      return true;
    }
  }
  if (opts.existingLockHash) {
    await writeVerifiedMarker(opts.markerPath, {
      importer: opts.importer,
      lockfile: opts.key,
      lockHash: opts.existingLockHash,
      hashValue: sri,
      builderFingerprint: opts.builderFingerprint,
    });
  }
  console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
  return true;
}
