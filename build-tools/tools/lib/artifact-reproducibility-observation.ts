import {
  isArtifactObservationProfile,
  observationPhases,
  type ArtifactObservationPhase,
  type ArtifactObservationProfile,
} from "./artifact-reproducibility-phases";
import {
  assertArtifactObservationFinalizationBoundary,
  type ArtifactObservationFinalizationBoundary,
} from "./artifact-reproducibility-finalization";
import type {
  ArtifactStoreDelta,
  ArtifactStorePathRole,
} from "./artifact-reproducibility-store-types";
export type {
  ArtifactStoreDelta,
  ArtifactStorePathRole,
} from "./artifact-reproducibility-store-types";
export type {
  ArtifactObservationPhase,
  ArtifactObservationProfile,
} from "./artifact-reproducibility-phases";

export const ARTIFACT_OBSERVATION_MAX_LOCAL_DELTA_KIB = 2 * 1024 * 1024;

export type ArtifactReproducibilityObservation = {
  schema: "viberoots.artifact-reproducibility-observation.v4";
  profile: ArtifactObservationProfile;
  subjectId: string;
  system: string;
  checkoutIdentity: string;
  builderIdentity: string;
  finalizationBoundary: ArtifactObservationFinalizationBoundary;
  phases: { phase: ArtifactObservationPhase; elapsedMs: number }[];
  stores: { local: ArtifactStoreDelta; remote: ArtifactStoreDelta };
  localTempRoot: {
    rootClass: "owned-ci-cell";
    before: SnapshotStats;
    after: SnapshotStats;
    deltaKib: number;
    maxDeltaKib: number;
  };
  lifecycle: {
    managedCommandCount: number;
    closedProcessGroupCount: number;
    survivingProcessGroupCount: 0;
    processGroups: Array<{
      leaderPid: number;
      processGroupId: number;
      descendantInspection: "verified";
      observedDescendantPids: number[];
      descendantsClosed: true;
    }>;
    managedCommands: "closed";
    ownedRootCleanup: "verified" | "not-applicable";
    openFileInspection: "verified";
    openFileOwnerCount: 0;
    deletedOpenFileInspection: "verified";
    deletedOpenFileOwnerCount: 0;
    hiddenCaptureInspection: "verified";
    captureState: "absent";
  };
};

export type SnapshotStats = { fileCount: number; dirCount: number; kb: number };

export function assertArtifactReproducibilityObservation(
  value: ArtifactReproducibilityObservation,
): void {
  exactKeys(value, [
    "builderIdentity",
    "checkoutIdentity",
    "finalizationBoundary",
    "lifecycle",
    "localTempRoot",
    "phases",
    "profile",
    "schema",
    "stores",
    "subjectId",
    "system",
  ]);
  if (value.schema !== "viberoots.artifact-reproducibility-observation.v4") {
    throw new Error("reproducibility observation schema is invalid");
  }
  if (!isArtifactObservationProfile(value.profile)) {
    throw new Error("reproducibility observation profile is invalid");
  }
  for (const field of ["subjectId", "system", "checkoutIdentity", "builderIdentity"] as const) {
    if (!String(value[field] || "").trim()) throw new Error(`observation ${field} is required`);
  }
  assertPhases(value.phases, value.profile);
  assertArtifactObservationFinalizationBoundary(value.finalizationBoundary);
  exactKeys(value.stores, ["local", "remote"]);
  assertStore(value.stores.local);
  assertStore(value.stores.remote);
  assertLocalRoot(value.localTempRoot);
  assertLifecycle(value.lifecycle);
  const expectedCleanup = value.profile === "matrix-consumer" ? "verified" : "not-applicable";
  if (value.lifecycle.ownedRootCleanup !== expectedCleanup) {
    throw new Error("observation cleanup authority does not match its profile");
  }
}

function assertPhases(
  value: ArtifactReproducibilityObservation["phases"],
  profile: ArtifactObservationProfile,
): void {
  const expectedPhases = observationPhases(profile);
  if (!Array.isArray(value) || value.length !== expectedPhases.length)
    throw new Error("observation requires the exact subject-appropriate phase timing set");
  const names = value.map(({ phase }) => phase);
  for (const [index, expected] of expectedPhases.entries()) {
    if (names[index] !== expected)
      throw new Error(`observation phase is missing or out of order: ${expected}`);
  }
  for (const phase of value) {
    exactKeys(phase, ["elapsedMs", "phase"]);
    if (!Number.isSafeInteger(phase.elapsedMs) || phase.elapsedMs < 0) {
      throw new Error("observation phase timing is invalid");
    }
  }
}

function assertStore(value: ArtifactStoreDelta): void {
  exactKeys(value, ["afterCount", "beforeCount", "newNarSize", "newPaths"]);
  if (
    !nonnegative(value.beforeCount) ||
    !nonnegative(value.afterCount) ||
    value.afterCount < value.beforeCount ||
    !nonnegative(value.newNarSize) ||
    !Array.isArray(value.newPaths)
  )
    throw new Error("observation store inventory is invalid");
  const roles: ArtifactStorePathRole[] = [
    "builder-probe",
    "evaluation-bundle",
    "artifact-output",
    "derivation",
    "dependency-closure",
  ];
  const seen = new Set<string>();
  let narSize = 0;
  for (const entry of value.newPaths) {
    exactKeys(entry, ["narSize", "path", "role"]);
    if (
      !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(entry.path) ||
      seen.has(entry.path) ||
      !nonnegative(entry.narSize) ||
      !roles.includes(entry.role)
    ) {
      throw new Error("observation contains an invalid or unreviewed new store path");
    }
    seen.add(entry.path);
    narSize += entry.narSize;
  }
  if (narSize !== value.newNarSize || value.afterCount - value.beforeCount !== seen.size) {
    throw new Error("observation store delta does not match its inventory");
  }
}

function assertLocalRoot(value: ArtifactReproducibilityObservation["localTempRoot"]): void {
  exactKeys(value, ["after", "before", "deltaKib", "maxDeltaKib", "rootClass"]);
  if (value.rootClass !== "owned-ci-cell") throw new Error("observation root is not owned");
  for (const stats of [value.before, value.after]) {
    exactKeys(stats, ["dirCount", "fileCount", "kb"]);
    if (Object.values(stats).some((entry) => !nonnegative(entry))) {
      throw new Error("observation local root statistics are invalid");
    }
  }
  if (
    value.deltaKib !== value.after.kb - value.before.kb ||
    value.maxDeltaKib !== ARTIFACT_OBSERVATION_MAX_LOCAL_DELTA_KIB ||
    value.deltaKib > value.maxDeltaKib
  ) {
    throw new Error("observation local root growth exceeds its reviewed bound");
  }
}

function assertLifecycle(value: ArtifactReproducibilityObservation["lifecycle"]): void {
  exactKeys(value, [
    "captureState",
    "closedProcessGroupCount",
    "deletedOpenFileInspection",
    "deletedOpenFileOwnerCount",
    "hiddenCaptureInspection",
    "managedCommandCount",
    "managedCommands",
    "openFileInspection",
    "openFileOwnerCount",
    "ownedRootCleanup",
    "processGroups",
    "survivingProcessGroupCount",
  ]);
  for (const group of value.processGroups) {
    exactKeys(group, [
      "descendantInspection",
      "descendantsClosed",
      "leaderPid",
      "observedDescendantPids",
      "processGroupId",
    ]);
  }
  if (
    !nonnegative(value.managedCommandCount) ||
    value.managedCommandCount === 0 ||
    value.closedProcessGroupCount !== value.managedCommandCount ||
    value.processGroups.length !== value.managedCommandCount ||
    value.processGroups.some(
      (group) =>
        group.leaderPid !== group.processGroupId ||
        !Number.isSafeInteger(group.processGroupId) ||
        group.processGroupId <= 1 ||
        group.descendantInspection !== "verified" ||
        !Array.isArray(group.observedDescendantPids) ||
        new Set(group.observedDescendantPids).size !== group.observedDescendantPids.length ||
        group.observedDescendantPids.some(
          (pid) => !Number.isSafeInteger(pid) || pid <= 1 || pid === group.leaderPid,
        ) ||
        group.descendantsClosed !== true,
    ) ||
    value.survivingProcessGroupCount !== 0 ||
    value.managedCommands !== "closed" ||
    !["verified", "not-applicable"].includes(value.ownedRootCleanup) ||
    value.openFileInspection !== "verified" ||
    value.openFileOwnerCount !== 0 ||
    value.deletedOpenFileInspection !== "verified" ||
    value.deletedOpenFileOwnerCount !== 0 ||
    value.hiddenCaptureInspection !== "verified" ||
    value.captureState !== "absent"
  ) {
    throw new Error("observation lifecycle closure is incomplete");
  }
}

function nonnegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`reproducibility observation has invalid fields: ${actual.join(", ")}`);
  }
}
