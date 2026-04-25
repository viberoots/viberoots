#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type {
  DeploymentLaneBranchGovernance,
  DeploymentLaneGovernance,
} from "./deployment-lane-governance.ts";
import type { DeploymentLanePolicy } from "./deployment-policy.ts";

export type DeploymentLaneGovernanceFact = {
  lanePolicyRef: string;
  governanceRef: string;
  governanceFingerprint: string;
  verifiedAt: string;
  verificationSource: "client_supplied" | "service_verified";
  scmBackend: DeploymentLaneGovernance["scmBackend"];
  repository: string;
  branchProtections: DeploymentLaneBranchGovernance[];
  recordRef?: string;
};

export type DeploymentLaneGovernanceSnapshot = Pick<
  DeploymentLaneGovernanceFact,
  "scmBackend" | "repository" | "branchProtections"
>;

function normalizeBranchProtections(value: unknown): DeploymentLaneBranchGovernance[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
      const raw = entry as Record<string, unknown>;
      const stage = typeof raw.stage === "string" ? raw.stage.trim() : "";
      const branch = typeof raw.branch === "string" ? raw.branch.trim() : "";
      const requiredChecks = Array.isArray(raw.requiredChecks)
        ? raw.requiredChecks.filter(
            (item): item is string => typeof item === "string" && item.trim() !== "",
          )
        : [];
      const normalAdvancePrincipals = Array.isArray(raw.normalAdvancePrincipals)
        ? raw.normalAdvancePrincipals.filter(
            (item): item is string => typeof item === "string" && item.trim() !== "",
          )
        : [];
      const emergencyDirectPushPrincipals = Array.isArray(raw.emergencyDirectPushPrincipals)
        ? raw.emergencyDirectPushPrincipals.filter(
            (item): item is string => typeof item === "string" && item.trim() !== "",
          )
        : [];
      if (raw.fastForwardOnly !== true || !stage || !branch) return undefined;
      return {
        stage,
        branch,
        requiredChecks,
        fastForwardOnly: true,
        normalAdvancePrincipals,
        emergencyDirectPushPrincipals,
      };
    })
    .filter((entry): entry is DeploymentLaneBranchGovernance => !!entry);
}

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
  const branchProtections = normalizeBranchProtections(raw.branchProtections);
  const recordRef = typeof raw.recordRef === "string" ? raw.recordRef.trim() : "";
  if (
    !lanePolicyRef ||
    !governanceRef ||
    !governanceFingerprint ||
    !verifiedAt ||
    !scmBackend ||
    !repository ||
    branchProtections.length === 0
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
    branchProtections,
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
  const branchProtections = normalizeBranchProtections(raw.branchProtections);
  if (!scmBackend || !repository || branchProtections.length === 0) return undefined;
  return { scmBackend, repository, branchProtections };
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
  const declared = opts.deployment.lanePolicy.governance.branchProtections.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  const actual = evidence.branchProtections.find(
    (entry) => entry.stage === opts.deployment.environmentStage,
  );
  if (!declared || !actual) {
    branchMismatch(opts.deployment, "missing stage protection");
  }
  if (declared.branch !== actual.branch) {
    branchMismatch(opts.deployment, `branch mismatch: ${actual.branch}`);
  }
  if (!actual.fastForwardOnly) {
    branchMismatch(opts.deployment, "fast-forward-only enforcement is missing");
  }
  if (!sameList(declared.requiredChecks, actual.requiredChecks)) {
    branchMismatch(opts.deployment, "required checks drift");
  }
  if (!sameList(declared.normalAdvancePrincipals, actual.normalAdvancePrincipals)) {
    branchMismatch(opts.deployment, "normal advance principals drift");
  }
  if (!sameList(declared.emergencyDirectPushPrincipals, actual.emergencyDirectPushPrincipals)) {
    branchMismatch(opts.deployment, "emergency direct-push principals drift");
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
  for (const declared of opts.lanePolicy.governance.branchProtections) {
    const actual = opts.snapshot.branchProtections.find((entry) => entry.stage === declared.stage);
    if (!actual) throw new Error(`missing required protected branch for ${declared.stage}`);
    if (actual.branch !== declared.branch) {
      throw new Error(`branch protection drift for ${declared.stage}: ${actual.branch}`);
    }
    if (!actual.fastForwardOnly) {
      throw new Error(`missing fast-forward-only enforcement for ${declared.stage}`);
    }
    if (!sameList(actual.requiredChecks, declared.requiredChecks)) {
      throw new Error(`required checks drift for ${declared.stage}`);
    }
    if (!sameList(actual.normalAdvancePrincipals, declared.normalAdvancePrincipals)) {
      throw new Error(`normal advance principals drift for ${declared.stage}`);
    }
    if (!sameList(actual.emergencyDirectPushPrincipals, declared.emergencyDirectPushPrincipals)) {
      throw new Error(`emergency direct-push principals drift for ${declared.stage}`);
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
    branchProtections: opts.snapshot.branchProtections,
  };
}
