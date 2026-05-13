#!/usr/bin/env zx-wrapper

export type DeploymentCheckReportingKind = "human_manual" | "ci_pipeline" | "external_status";

export type DeploymentCheckEvidence = {
  name: string;
  subject: string;
  status: "passed" | "failed";
  checkedAt: string;
  deploymentId?: string;
  environmentStage?: string;
  admissionPolicyRef?: string;
  recordRef?: string;
  reportingKind?: DeploymentCheckReportingKind;
  reporterIdentity?: string;
};

export type DeploymentAdmissionCheckFact = {
  name: string;
  subject: string;
  checkedAt: string;
  deploymentId?: string;
  environmentStage?: string;
  admissionPolicyRef?: string;
  recordRef?: string;
  reportingKind?: DeploymentCheckReportingKind;
  reporterIdentity?: string;
};

export function normalizeCheckReportingKind(
  value: unknown,
): DeploymentCheckReportingKind | undefined {
  return value === "human_manual" || value === "ci_pipeline" || value === "external_status"
    ? value
    : undefined;
}
