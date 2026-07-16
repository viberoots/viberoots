import { withPnpmStoreBuildFlakeRef } from "./build-flake";
import { ensureExactStoreGcRoot } from "./exact-store-gc-root";
import { buildStore } from "./nix";
import {
  evaluatePnpmStoreDerivationIdentity,
  inspectCommittedFinalPnpmStore,
  resolveFinalPnpmStore,
} from "./realized-store";

export async function materializeCommittedPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  storeAttr: string;
  lockHash: string;
}): Promise<{ fixedStorePath: string; derivationIdentity: string }> {
  return await withPnpmStoreBuildFlakeRef(
    { repoRoot: opts.repoRoot, importer: opts.importer, baseFlakeRef: opts.flakeRef },
    async (buildFlakeRef, filteredEnv) => {
      const env = { ...process.env, ...filteredEnv, NIX_PNPM_MATERIALIZE: "1" };
      const before = await inspectCommittedFinalPnpmStore({
        repoRoot: opts.repoRoot,
        importer: opts.importer,
        flakeRef: buildFlakeRef,
        attrPath: opts.storeAttr,
        env,
      });
      if (before.status === "invalid") {
        throw new Error(`committed pnpm store is invalid for ${opts.importer}; repair: run u`);
      }
      if (before.status === "absent") {
        const built = await buildStore(opts.storeAttr, buildFlakeRef, undefined, env, {
          ownedDerivationName: `pnpm-store-lock-${opts.lockHash}`,
        });
        if (!built.ok) {
          throw new Error(
            `failed to materialize committed pnpm store for ${opts.importer}\n\n${built.output}`,
          );
        }
        if (built.outPath !== before.path) {
          throw new Error(
            `materialized pnpm store path mismatch for ${opts.importer}: ${built.outPath || "(empty)"}; expected ${before.path}`,
          );
        }
      }
      const resolved = await resolveFinalPnpmStore({
        repoRoot: opts.repoRoot,
        importer: opts.importer,
        flakeRef: buildFlakeRef,
        attrPath: opts.storeAttr,
        env,
      });
      const derivationIdentity = await evaluatePnpmStoreDerivationIdentity({
        repoRoot: opts.repoRoot,
        flakeRef: buildFlakeRef,
        attrPath: opts.storeAttr,
        env,
      });
      await ensureExactStoreGcRoot({
        repoRoot: opts.repoRoot,
        importer: opts.importer,
        storePath: resolved.fixedStorePath,
        mode: "reconcile",
        env,
      });
      return { fixedStorePath: resolved.fixedStorePath, derivationIdentity };
    },
  );
}
