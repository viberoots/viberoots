#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract.ts";
import { progressiveRolloutIsActive } from "./nixos-shared-host-progressive-rollout.ts";

function submissionsDir(recordsRoot: string) {
  return path.join(path.resolve(recordsRoot), "control-plane", "submissions");
}

export async function ensureNoActiveProgressiveRun(
  recordsRoot: string,
  lockScope: string,
  submissionId: string,
) {
  try {
    const entries = await fsp.readdir(submissionsDir(recordsRoot));
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(submissionsDir(recordsRoot), entry);
      const submission = JSON.parse(
        await fsp.readFile(filePath, "utf8"),
      ) as NixosSharedHostControlPlaneSubmission;
      if (submission.submissionId === submissionId || submission.lockScope !== lockScope) continue;
      if (progressiveRolloutIsActive(submission.progressiveRollout)) {
        throw new DeploymentAdmissionError(
          "supersedence_blocked",
          `active progressive rollout already exists for ${lockScope}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
}
