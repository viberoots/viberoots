#!/usr/bin/env zx-wrapper
export type ProtectedDeploymentClass = "shared_nonprod" | "production_facing";

export type RestoreTestCadence = "monthly" | "quarterly";

export type DeploymentControlPlaneResiliencePolicy = {
  protectionClass: ProtectedDeploymentClass;
  targetRpoMinutes: number;
  targetRtoMinutes: number;
  minimumArtifactRetentionDays: number;
  minimumRecordRetentionDays: number;
  minimumRestoreTestCadence: RestoreTestCadence;
};

const POLICY_BY_PROTECTION_CLASS: Record<
  ProtectedDeploymentClass,
  DeploymentControlPlaneResiliencePolicy
> = {
  shared_nonprod: {
    protectionClass: "shared_nonprod",
    targetRpoMinutes: 240,
    targetRtoMinutes: 480,
    minimumArtifactRetentionDays: 30,
    minimumRecordRetentionDays: 180,
    minimumRestoreTestCadence: "quarterly",
  },
  production_facing: {
    protectionClass: "production_facing",
    targetRpoMinutes: 15,
    targetRtoMinutes: 60,
    minimumArtifactRetentionDays: 180,
    minimumRecordRetentionDays: 365,
    minimumRestoreTestCadence: "monthly",
  },
};

export function isProtectedDeploymentClass(value: string): value is ProtectedDeploymentClass {
  return value === "shared_nonprod" || value === "production_facing";
}

export function resiliencePolicyForProtectionClass(
  protectionClass: string,
): DeploymentControlPlaneResiliencePolicy | undefined {
  return isProtectedDeploymentClass(protectionClass)
    ? POLICY_BY_PROTECTION_CLASS[protectionClass]
    : undefined;
}
