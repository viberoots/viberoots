#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentRunRecordLike } from "./deployment-admission-records";

export function assertFoundationMigrationPrerequisite(opts: {
  prerequisiteId: string;
  record: DeploymentRunRecordLike;
  requiredRevision: string;
}) {
  const foundationMigration = opts.record.foundationMigrationOutcome;
  if (!foundationMigration || foundationMigration.status !== "succeeded") {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `foundation prerequisite lacks successful migration evidence: ${opts.prerequisiteId}`,
    );
  }
  if (!foundationMigration.sourceRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `foundation migration evidence is missing source revision: ${opts.prerequisiteId}`,
    );
  }
  if (!opts.requiredRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `foundation migration prerequisite requires a reviewed source revision: ${opts.prerequisiteId}`,
    );
  }
  if (foundationMigration.sourceRevision !== opts.requiredRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `foundation migration evidence is stale for ${opts.prerequisiteId}: required source ${opts.requiredRevision}, found ${foundationMigration.sourceRevision}`,
    );
  }
}
