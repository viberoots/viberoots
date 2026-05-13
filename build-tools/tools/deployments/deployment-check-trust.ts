#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentAdmissionCheckFact } from "./deployment-admission-evidence";

export function trustedCheck(
  checks: DeploymentAdmissionCheckFact[],
  deployment: DeploymentTarget,
  name: string,
): DeploymentAdmissionCheckFact | undefined {
  const candidates = checks.filter((check) => check.name === name);
  if (candidates.length === 0) return undefined;
  const trustedReporters = deployment.lanePolicy.governance.trustedReporterIdentities;
  const hit = candidates.find(
    (check) => check.reporterIdentity && trustedReporters.includes(check.reporterIdentity),
  );
  if (hit) return hit;
  const reporters = candidates.map((check) => check.reporterIdentity || "<missing>");
  throw new DeploymentAdmissionError(
    "no_longer_admitted",
    `protected/shared admission requires trusted reporter for check ${name}; got ${Array.from(new Set(reporters)).join(", ")}`,
  );
}
