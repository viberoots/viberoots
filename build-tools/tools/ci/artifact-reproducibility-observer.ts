import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { readSnapshotStats } from "../dev/filtered-flake-diagnostics";
import { withArtifactCommandLifecycle } from "../lib/artifact-command-runner";
import { artifactObservationFinalizationBoundary } from "../lib/artifact-reproducibility-finalization";
import {
  ARTIFACT_OBSERVATION_MAX_LOCAL_DELTA_KIB,
  assertArtifactReproducibilityObservation,
  type ArtifactObservationPhase,
  type ArtifactReproducibilityObservation,
} from "../lib/artifact-reproducibility-observation";
import {
  canonicalOpenFileInspectionOptions,
  deletedOpenFileOwnerPids,
  openFileOwnerPids,
} from "../lib/open-file-inspection";
import { readArtifactCellObservationInput } from "./artifact-reproducibility-cell-input";
import {
  ArtifactProcessLifecycle,
  mergeArtifactProcessLifecycle,
} from "./artifact-reproducibility-process-evidence";
import {
  classifyOwnedStorePath,
  readOutputAuthority,
  readStoreInventory,
  storeDelta,
  type StoreInventory,
  type RunNixForObservation,
} from "./artifact-reproducibility-store-observation";

export async function observeArtifactReproducibility<T>(opts: {
  runRemoteNix: RunNixForObservation;
  runLocalNix: RunNixForObservation;
  cellObservationInput: string;
  ownedRootCleanup: "verified" | "not-applicable";
  cleanedOwnedRoot?: string;
  localTempRoot: string;
  evaluationBundleRoots: readonly string[];
  evidenceToolEnv: NodeJS.ProcessEnv;
  lifecycle: ArtifactProcessLifecycle;
  remoteStoreBefore: StoreInventory;
  remoteProbePaths: ReadonlySet<string>;
  operation: (runNix: RunNixForObservation) => Promise<T>;
  afterOperation?: (result: T) => Promise<void>;
  describe: (result: T) => {
    subjectId: string;
    system: string;
    checkoutIdentity: string;
    builderIdentity: string;
    artifactOutputPath: string;
    derivationPath: string;
  };
}): Promise<{ result: T; observation: ArtifactReproducibilityObservation }> {
  const baseline = await readArtifactCellObservationInput(opts.cellObservationInput);
  if (baseline.input.ownedRootCleanup !== opts.ownedRootCleanup) {
    throw new Error("artifact cell cleanup evidence does not match its verified disk authority");
  }
  const phases: ArtifactReproducibilityObservation["phases"] = [...baseline.input.phases];
  let ordinaryBuilds = 0;
  const lifecycle = opts.lifecycle;
  const observedRunNix: RunNixForObservation = async (args) => {
    const phase = buildPhase(args, ordinaryBuilds);
    if (phase && phase !== "forced-rebuild") ordinaryBuilds += 1;
    const started = performance.now();
    try {
      return await opts.runRemoteNix(args);
    } finally {
      if (phase) phases.push({ phase, elapsedMs: Math.round(performance.now() - started) });
    }
  };
  const captured = await withArtifactCommandLifecycle(lifecycle, async () => {
    const result = await opts.operation(observedRunNix);
    await opts.afterOperation?.(result);
    const identity = opts.describe(result);
    const authority = await readOutputAuthority(
      opts.runRemoteNix,
      identity.artifactOutputPath,
      identity.derivationPath,
    );
    authority.derivations.add(identity.derivationPath);
    const [afterRemote, afterLocal] = await Promise.all([
      readStoreInventory(opts.runRemoteNix),
      readStoreInventory(opts.runLocalNix),
    ]);
    return { afterLocal, afterRemote, authority, identity, result };
  });
  const openFileInspection = canonicalOpenFileInspectionOptions(opts.evidenceToolEnv);
  const deletedOpenRoot = opts.cleanedOwnedRoot || opts.localTempRoot;
  const [afterTemp, openOwners, deletedOpenOwners, captureState] = await Promise.all([
    readSnapshotStats(opts.localTempRoot, opts.evidenceToolEnv),
    openFileOwnerPids(opts.localTempRoot, openFileInspection),
    deletedOpenFileOwnerPids(deletedOpenRoot, openFileInspection),
    assertNoHiddenCaptureState(opts.localTempRoot),
  ]);
  if (openOwners.length || deletedOpenOwners.length) {
    throw new Error("artifact cell retains open or deleted-open capture files");
  }
  const lifecycleSummary = mergeArtifactProcessLifecycle(
    baseline.input.lifecycle,
    lifecycle.assertComplete(),
  );
  const observation: ArtifactReproducibilityObservation = {
    schema: "viberoots.artifact-reproducibility-observation.v4",
    profile: baseline.input.profile,
    subjectId: captured.identity.subjectId,
    system: captured.identity.system,
    checkoutIdentity: captured.identity.checkoutIdentity,
    builderIdentity: captured.identity.builderIdentity,
    finalizationBoundary: artifactObservationFinalizationBoundary(),
    phases,
    stores: {
      local: storeDelta(baseline.localStoreBefore, captured.afterLocal, (storePath) => {
        if (opts.evaluationBundleRoots.includes(storePath)) return "evaluation-bundle";
        throw new Error(`local Nix store delta is foreign to the artifact cell: ${storePath}`);
      }),
      remote: storeDelta(opts.remoteStoreBefore, captured.afterRemote, (storePath) =>
        classifyObservedRemoteStorePath({
          storePath,
          remoteProbePaths: opts.remoteProbePaths,
          evaluationBundleRoots: opts.evaluationBundleRoots,
          outputPath: captured.identity.artifactOutputPath,
          authority: captured.authority,
        }),
      ),
    },
    localTempRoot: {
      rootClass: "owned-ci-cell",
      before: baseline.input.localTempBefore,
      after: afterTemp,
      deltaKib: afterTemp.kb - baseline.input.localTempBefore.kb,
      maxDeltaKib: ARTIFACT_OBSERVATION_MAX_LOCAL_DELTA_KIB,
    },
    lifecycle: {
      ...lifecycleSummary,
      managedCommands: "closed",
      ownedRootCleanup: baseline.input.ownedRootCleanup,
      openFileInspection: "verified",
      openFileOwnerCount: 0,
      deletedOpenFileInspection: "verified",
      deletedOpenFileOwnerCount: 0,
      hiddenCaptureInspection: "verified",
      captureState,
    },
  };
  assertArtifactReproducibilityObservation(observation);
  return { result: captured.result, observation };
}

export function classifyObservedRemoteStorePath(opts: {
  storePath: string;
  remoteProbePaths: ReadonlySet<string>;
  evaluationBundleRoots: readonly string[];
  outputPath: string;
  authority: { closure: Set<string>; derivations: Set<string> };
}): "builder-probe" | ReturnType<typeof classifyOwnedStorePath> {
  if (opts.remoteProbePaths.has(opts.storePath)) return "builder-probe";
  return classifyOwnedStorePath(
    opts.storePath,
    opts.evaluationBundleRoots,
    opts.outputPath,
    opts.authority,
  );
}

async function assertNoHiddenCaptureState(root: string): Promise<"absent"> {
  const forbidden =
    /(?:viberoots-command-capture|\.viberoots-evaluation-bundle-(?:owner|process-group))/u;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (forbidden.test(entry.name)) {
        throw new Error(`artifact cell retains hidden capture state: ${candidate}`);
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(candidate);
    }
  }
  return "absent";
}

function buildPhase(args: string[], ordinaryBuilds: number): ArtifactObservationPhase | null {
  if (args[0] !== "build") return null;
  if (args.includes("--rebuild")) return "forced-rebuild";
  return ordinaryBuilds === 0 ? "initial-build" : "warm-build";
}

export { classifyOwnedStorePath } from "./artifact-reproducibility-store-observation";
