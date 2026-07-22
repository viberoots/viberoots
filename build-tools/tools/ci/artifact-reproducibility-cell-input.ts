import fs from "node:fs/promises";
import type { ArtifactCommandLifecycleSummary } from "../lib/artifact-command-runner";
import type {
  ArtifactObservationPhase,
  SnapshotStats,
} from "../lib/artifact-reproducibility-observation";
import {
  isArtifactObservationProfile,
  observationPhases,
  type ArtifactObservationProfile,
} from "../lib/artifact-reproducibility-phases";
import {
  storeInventoryFromJson,
  type StoreInventory,
} from "./artifact-reproducibility-store-observation";

export type ArtifactCellObservationInput = {
  schema: "viberoots.artifact-cell-observation-input.v2";
  profile: ArtifactObservationProfile;
  localStoreBefore: Array<{ path: string; narSize: number }>;
  localTempBefore: SnapshotStats;
  phases: { phase: ArtifactObservationPhase; elapsedMs: number }[];
  lifecycle: ArtifactCommandLifecycleSummary;
  ownedRootCleanup: "verified" | "not-applicable";
};

export async function readArtifactCellObservationInput(file: string): Promise<{
  input: ArtifactCellObservationInput;
  localStoreBefore: StoreInventory;
}> {
  const input = JSON.parse(await fs.readFile(file, "utf8")) as ArtifactCellObservationInput;
  if (input.schema !== "viberoots.artifact-cell-observation-input.v2") {
    throw new Error("artifact cell observation input schema is invalid");
  }
  if (!isArtifactObservationProfile(input.profile)) {
    throw new Error("artifact cell observation input profile is invalid");
  }
  const expectedPreBuildPhases = observationPhases(input.profile).slice(0, -3);
  if (
    !Array.isArray(input.phases) ||
    input.phases.map(({ phase }) => phase).join("\0") !== expectedPreBuildPhases.join("\0")
  ) {
    throw new Error("artifact cell observation input lacks its subject-appropriate phase timings");
  }
  for (const phase of input.phases) {
    if (!Number.isSafeInteger(phase.elapsedMs) || phase.elapsedMs < 0) {
      throw new Error("artifact cell observation phase timing is invalid");
    }
  }
  if (
    input.lifecycle.survivingProcessGroupCount !== 0 ||
    input.lifecycle.closedProcessGroupCount !== input.lifecycle.managedCommandCount ||
    input.lifecycle.processGroups.length !== input.lifecycle.managedCommandCount ||
    input.lifecycle.processGroups.some(
      (group) =>
        group.leaderPid !== group.processGroupId ||
        group.descendantInspection !== "verified" ||
        !Array.isArray(group.observedDescendantPids) ||
        group.descendantsClosed !== true,
    )
  ) {
    throw new Error("artifact cell observation input contains unclosed process groups");
  }
  if (!["verified", "not-applicable"].includes(input.ownedRootCleanup)) {
    throw new Error("artifact cell observation input cleanup authority is invalid");
  }
  const expectedCleanup = input.profile === "matrix-consumer" ? "verified" : "not-applicable";
  if (input.ownedRootCleanup !== expectedCleanup) {
    throw new Error("artifact cell observation input cleanup authority does not match its profile");
  }
  return { input, localStoreBefore: storeInventoryFromJson(input.localStoreBefore) };
}
