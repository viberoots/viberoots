import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { readSnapshotStats } from "../dev/filtered-flake-diagnostics";
import { withArtifactCommandLifecycle } from "../lib/artifact-command-runner";
import type { ArtifactObservationPhase } from "../lib/artifact-reproducibility-observation";
import {
  observationPhases,
  type ArtifactObservationProfile,
} from "../lib/artifact-reproducibility-phases";
import { ArtifactProcessLifecycle } from "./artifact-reproducibility-process-evidence";
import {
  readStoreInventory,
  storeInventoryJson,
  type RunNixForObservation,
} from "./artifact-reproducibility-store-observation";

export async function beginArtifactCellObservation(opts: {
  localTempRoot: string;
  runLocalNix: RunNixForObservation;
  profile: ArtifactObservationProfile;
  evidenceToolEnv: NodeJS.ProcessEnv;
}): Promise<{
  observe<T>(operation: () => Promise<T>): Promise<T>;
  phase<T>(name: ArtifactObservationPhase, operation: () => Promise<T>): Promise<T>;
  record(name: ArtifactObservationPhase, elapsedMs: number): void;
  write(file: string, ownedRootCleanup: "verified" | "not-applicable"): Promise<void>;
}> {
  const lifecycle = new ArtifactProcessLifecycle({ env: opts.evidenceToolEnv });
  const localTempBefore = await readSnapshotStats(opts.localTempRoot, opts.evidenceToolEnv);
  const localStoreBefore = await withArtifactCommandLifecycle(
    lifecycle,
    async () => await readStoreInventory(opts.runLocalNix),
  );
  const phases: { phase: ArtifactObservationPhase; elapsedMs: number }[] = [];
  const record = (phase: ArtifactObservationPhase, elapsedMs: number): void => {
    if (phases.some((entry) => entry.phase === phase)) {
      throw new Error(`artifact cell phase timing is duplicated: ${phase}`);
    }
    phases.push({ phase, elapsedMs });
  };
  return {
    observe: async (operation) => await withArtifactCommandLifecycle(lifecycle, operation),
    phase: async (name, operation) => {
      const started = performance.now();
      try {
        return await withArtifactCommandLifecycle(lifecycle, operation);
      } finally {
        record(name, Math.round(performance.now() - started));
      }
    },
    record,
    write: async (file, ownedRootCleanup) => {
      const expected = observationPhases(opts.profile).slice(0, -3);
      phases.sort((left, right) => expected.indexOf(left.phase) - expected.indexOf(right.phase));
      if (phases.map(({ phase }) => phase).join("\0") !== expected.join("\0")) {
        throw new Error("artifact cell baseline lacks the exact pre-build phase timing set");
      }
      await fs.writeFile(
        file,
        `${JSON.stringify({
          schema: "viberoots.artifact-cell-observation-input.v2",
          profile: opts.profile,
          localStoreBefore: storeInventoryJson(localStoreBefore),
          localTempBefore,
          phases,
          lifecycle: lifecycle.assertComplete(),
          ownedRootCleanup,
        })}\n`,
        { flag: "wx", mode: 0o444 },
      );
    },
  };
}
