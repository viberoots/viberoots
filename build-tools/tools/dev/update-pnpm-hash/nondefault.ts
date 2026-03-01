import { type ManagedCommandActivity } from "../../lib/managed-command.ts";
import { updateNodeModulesHashesJson } from "./hashes-json.ts";
import { withHeartbeat } from "./heartbeat.ts";
import { generateImporterLockfile, makeFilteredFlakeRef } from "./lockfile.ts";
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
  let tempFlake: { flakeRef: string; cleanup: () => Promise<void> } | null = null;
  if (opts.hasValidExistingHash) {
    if (
      opts.existingLockHash &&
      opts.existingMarker &&
      opts.existingMarker.importer === opts.importer &&
      opts.existingMarker.lockfile === opts.key &&
      opts.existingMarker.lockHash === opts.existingLockHash &&
      opts.existingMarker.hashValue === opts.existingHash
    ) {
      console.log(
        `[update-pnpm-hash] importer=${opts.importer} step=skip-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
      );
      return true;
    }
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=stale-existing-hash attr=${opts.storeAttr} lockfile=${opts.key}`,
    );
  }
  try {
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=prepare-filtered-flake attr=${opts.unfixedAttr}`,
    );
    tempFlake = await withHeartbeat(
      `importer=${opts.importer} step=prepare-filtered-flake attr=${opts.unfixedAttr}`,
      makeFilteredFlakeRef(opts.repoRoot),
    );
    const prewarmFlakeRef = tempFlake.flakeRef.replace(/#pnpm$/, "");
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s`,
    );
    const unfixedActivity = newActivity();
    let pre = await withHeartbeat(
      `importer=${opts.importer} step=unfixed-build attr=${opts.unfixedAttr}`,
      buildUnfixedAndHash(opts.unfixedAttr, prewarmFlakeRef, unfixedActivity),
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
        buildUnfixedAndHash(opts.unfixedAttr, prewarmFlakeRef, retryActivity),
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
    let sri: string = pre.sri;
    await updateNodeModulesHashesJson(opts.key, sri);
    if (tempFlake) {
      await tempFlake.cleanup();
      tempFlake = null;
    }
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=prepare-filtered-flake attr=${opts.storeAttr}`,
    );
    tempFlake = await withHeartbeat(
      `importer=${opts.importer} step=prepare-filtered-flake attr=${opts.storeAttr}`,
      makeFilteredFlakeRef(opts.repoRoot),
    );
    const refreshedFlakeRef = tempFlake.flakeRef.replace(/#pnpm$/, "");
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr} timeout=${opts.timeoutSec}s`,
    );
    const verifyAfterActivity = newActivity();
    const verifyAfterHash = await withHeartbeat(
      `importer=${opts.importer} step=fixed-build-after-hash attr=${opts.storeAttr}`,
      buildStore(opts.storeAttr, refreshedFlakeRef, verifyAfterActivity),
      { activity: verifyAfterActivity },
    );
    if (!verifyAfterHash.ok) {
      const suggestedFromFixed = extractHash(String(verifyAfterHash.output || ""));
      if (suggestedFromFixed && suggestedFromFixed !== sri) {
        sri = suggestedFromFixed;
        await updateNodeModulesHashesJson(opts.key, sri);
        if (tempFlake) {
          await tempFlake.cleanup();
          tempFlake = null;
        }
        tempFlake = await withHeartbeat(
          `importer=${opts.importer} step=prepare-filtered-flake attr=${opts.storeAttr}`,
          makeFilteredFlakeRef(opts.repoRoot),
        );
        const retryFlakeRef = tempFlake.flakeRef.replace(/#pnpm$/, "");
        const retryAfterActivity = newActivity();
        const retryAfterHash = await withHeartbeat(
          `importer=${opts.importer} step=fixed-build-after-hash-retry attr=${opts.storeAttr}`,
          buildStore(opts.storeAttr, retryFlakeRef, retryAfterActivity),
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
      });
    }
    console.log("pnpm-store:", opts.storeAttr, "hash updated and build succeeded");
    return true;
  } finally {
    if (tempFlake) {
      await tempFlake.cleanup();
    }
  }
}
