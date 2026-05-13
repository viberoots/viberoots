#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import {
  normalizeApprovalBoundaries,
  normalizeSourceRefPolicies,
  normalizeTrustedReporterIdentities,
} from "./deployment-admission-governance-normalize";
import type {
  DeploymentApprovalBoundary,
  DeploymentLaneGovernance,
  DeploymentSourceRefPolicy,
} from "./deployment-lane-governance";
import type { DeploymentLanePolicy } from "./deployment-policy";

export type DeploymentLaneGovernanceFact = {
  lanePolicyRef: string;
  governanceRef: string;
  governanceFingerprint: string;
  verifiedAt: string;
  verificationSource: "client_supplied" | "service_verified";
  scmBackend: DeploymentLaneGovernance["scmBackend"];
  repository: string;
  sourceRefPolicies: DeploymentSourceRefPolicy[];
  trustedReporterIdentities: string[];
  requiredApprovalBoundaries: DeploymentApprovalBoundary[];
  recordRef?: string;
};

export type DeploymentLaneGovernanceSnapshot = Pick<
  DeploymentLaneGovernanceFact,
  | "scmBackend"
  | "repository"
  | "sourceRefPolicies"
  | "trustedReporterIdentities"
  | "requiredApprovalBoundaries"
>;

export function normalizeLaneGovernanceEvidence(
  value: unknown,
): DeploymentLaneGovernanceFact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const lanePolicyRef = typeof raw.lanePolicyRef === "string" ? raw.lanePolicyRef.trim() : "";
  const governanceRef = typeof raw.governanceRef === "string" ? raw.governanceRef.trim() : "";
  const governanceFingerprint =
    typeof raw.governanceFingerprint === "string" ? raw.governanceFingerprint.trim() : "";
  const verifiedAt = typeof raw.verifiedAt === "string" ? raw.verifiedAt.trim() : "";
  const verificationSource =
    raw.verificationSource === "service_verified" ? "service_verified" : "client_supplied";
  const scmBackend =
    raw.scmBackend === "github" || raw.scmBackend === "gitlab" ? raw.scmBackend : "";
  const repository = typeof raw.repository === "string" ? raw.repository.trim() : "";
  const sourceRefPolicies = normalizeSourceRefPolicies(raw.sourceRefPolicies);
  const trustedReporterIdentities = normalizeTrustedReporterIdentities(
    raw.trustedReporterIdentities,
  );
  const requiredApprovalBoundaries = normalizeApprovalBoundaries(raw.requiredApprovalBoundaries);
  const recordRef = typeof raw.recordRef === "string" ? raw.recordRef.trim() : "";
  if (
    !lanePolicyRef ||
    !governanceRef ||
    !governanceFingerprint ||
    !verifiedAt ||
    !scmBackend ||
    !repository ||
    sourceRefPolicies.length === 0 ||
    trustedReporterIdentities.length === 0 ||
    requiredApprovalBoundaries.length === 0
  ) {
    return undefined;
  }
  return {
    lanePolicyRef,
    governanceRef,
    governanceFingerprint,
    verifiedAt,
    verificationSource,
    scmBackend,
    repository,
    sourceRefPolicies,
    trustedReporterIdentities,
    requiredApprovalBoundaries,
    ...(recordRef ? { recordRef } : {}),
  };
}

export function normalizeLaneGovernanceSnapshot(
  value: unknown,
): DeploymentLaneGovernanceSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const scmBackend =
    raw.scmBackend === "github" || raw.scmBackend === "gitlab" ? raw.scmBackend : "";
  const repository = typeof raw.repository === "string" ? raw.repository.trim() : "";
  const sourceRefPolicies = normalizeSourceRefPolicies(raw.sourceRefPolicies);
  const trustedReporterIdentities = normalizeTrustedReporterIdentities(
    raw.trustedReporterIdentities,
  );
  const requiredApprovalBoundaries = normalizeApprovalBoundaries(raw.requiredApprovalBoundaries);
  if (
    !scmBackend ||
    !repository ||
    sourceRefPolicies.length === 0 ||
    trustedReporterIdentities.length === 0 ||
    requiredApprovalBoundaries.length === 0
  ) {
    return undefined;
  }
  return {
    scmBackend,
    repository,
    sourceRefPolicies,
    trustedReporterIdentities,
    requiredApprovalBoundaries,
  };
}

function sorted(value: string[]): string[] {
  return [...value].sort();
}

function sameList(left: string[], right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function branchMismatch(
  deployment: { lanePolicyRef: string; environmentStage: string },
  message: string,
): never {
  throw new DeploymentAdmissionError(
    "no_longer_admitted",
    `lane governance mismatch for ${deployment.lanePolicyRef} ${deployment.environmentStage}: ${message}`,
  );
}

export function evaluateLaneGovernanceFact(opts: {
  deployment: { lanePolicyRef: string; environmentStage: string; lanePolicy: DeploymentLanePolicy };
  evidence?: DeploymentLaneGovernanceFact;
}): DeploymentLaneGovernanceFact {
  const evidence = opts.evidence;
  if (!evidence) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared admission requires governance verification for ${opts.deployment.lanePolicyRef}`,
    );
  }
  if (evidence.lanePolicyRef !== opts.deployment.lanePolicyRef) {
    branchMismatch(opts.deployment, `lane_policy mismatch: ${evidence.lanePolicyRef}`);
  }
  if (evidence.governanceRef !== opts.deployment.lanePolicy.governanceRef) {
    branchMismatch(opts.deployment, `governance mismatch: ${evidence.governanceRef}`);
  }
  if (evidence.governanceFingerprint !== opts.deployment.lanePolicy.governance.fingerprint) {
    branchMismatch(opts.deployment, "governance fingerprint drift");
  }
  const declared = opts.deployment.lanePolicy.governance.sourceRefPolicies.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  const actual = evidence.sourceRefPolicies.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  if (!declared || !actual) {
    branchMismatch(opts.deployment, "missing stage source-ref policy");
  }
  if (!sameList(declared.allowedRefs, actual.allowedRefs)) {
    branchMismatch(opts.deployment, "allowed source refs drift");
  }
  if (!sameList(declared.requiredChecks, actual.requiredChecks)) {
    branchMismatch(opts.deployment, "required checks drift");
  }
  if (
    !sameList(
      opts.deployment.lanePolicy.governance.trustedReporterIdentities,
      evidence.trustedReporterIdentities,
    )
  ) {
    branchMismatch(opts.deployment, "trusted reporter identities drift");
  }
  const declaredBoundary = opts.deployment.lanePolicy.governance.requiredApprovalBoundaries.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  const actualBoundary = evidence.requiredApprovalBoundaries.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  if (declaredBoundary || actualBoundary) {
    if (!declaredBoundary || !actualBoundary) {
      branchMismatch(opts.deployment, "required approval boundary drift");
    }
    if (!sameList(declaredBoundary.requiredApprovals, actualBoundary.requiredApprovals)) {
      branchMismatch(opts.deployment, "required approval boundary drift");
    }
  }
  return evidence;
}

export function verifyLaneGovernanceSnapshot(opts: {
  lanePolicy: DeploymentLanePolicy;
  snapshot: DeploymentLaneGovernanceSnapshot;
  verifiedAt?: string;
  verificationSource?: DeploymentLaneGovernanceFact["verificationSource"];
}): DeploymentLaneGovernanceFact {
  if (opts.snapshot.scmBackend !== opts.lanePolicy.governance.scmBackend) {
    throw new Error(`lane governance backend mismatch: ${opts.snapshot.scmBackend}`);
  }
  if (opts.snapshot.repository !== opts.lanePolicy.governance.repository) {
    throw new Error(`lane governance repository mismatch: ${opts.snapshot.repository}`);
  }
  for (const declared of opts.lanePolicy.governance.sourceRefPolicies) {
    const actual = opts.snapshot.sourceRefPolicies.find((entry) => entry.stage === declared.stage);
    if (!actual) throw new Error(`missing required source-ref policy for ${declared.stage}`);
    if (!sameList(actual.allowedRefs, declared.allowedRefs)) {
      throw new Error(`allowed source refs drift for ${declared.stage}`);
    }
    if (!sameList(actual.requiredChecks, declared.requiredChecks)) {
      throw new Error(`required checks drift for ${declared.stage}`);
    }
  }
  if (
    !sameList(
      opts.snapshot.trustedReporterIdentities,
      opts.lanePolicy.governance.trustedReporterIdentities,
    )
  ) {
    throw new Error("trusted reporter identities drift");
  }
  for (const declared of opts.lanePolicy.governance.requiredApprovalBoundaries) {
    const actual = opts.snapshot.requiredApprovalBoundaries.find(
      (entry) => entry.stage === declared.stage,
    );
    if (!actual) throw new Error(`missing required approval boundary for ${declared.stage}`);
    if (!sameList(actual.requiredApprovals, declared.requiredApprovals)) {
      throw new Error(`required approval boundary drift for ${declared.stage}`);
    }
  }
  return {
    lanePolicyRef: opts.lanePolicy.ref,
    governanceRef: opts.lanePolicy.governanceRef,
    governanceFingerprint: opts.lanePolicy.governance.fingerprint,
    verifiedAt: opts.verifiedAt || new Date().toISOString(),
    verificationSource: opts.verificationSource || "client_supplied",
    scmBackend: opts.snapshot.scmBackend,
    repository: opts.snapshot.repository,
    sourceRefPolicies: opts.snapshot.sourceRefPolicies,
    trustedReporterIdentities: opts.snapshot.trustedReporterIdentities,
    requiredApprovalBoundaries: opts.snapshot.requiredApprovalBoundaries,
  };
}
