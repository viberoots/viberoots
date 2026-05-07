#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { OpenTofuDeployment } from "./contract";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan";
import type { OpenTofuApplyOutcome } from "./opentofu-apply";
import type { OpenTofuAdmittedContext } from "./opentofu-admission";
import type { FoundationMigrationOutcome } from "./foundation-migration";

export const OPENTOFU_FOUNDATION_RECORD_SCHEMA = "opentofu-foundation-record@1";

export type OpenTofuFoundationRecord = {
  schemaVersion: typeof OPENTOFU_FOUNDATION_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: "provision_only";
  runClassification: "provision_only";
  lifecycleState: "finished";
  finalOutcome: "succeeded" | "publish_failed";
  deploymentId: string;
  deploymentLabel: string;
  provider: "opentofu";
  providerTarget: OpenTofuDeployment["providerTarget"];
  providerTargetIdentity: string;
  publisherType: "provision-only";
  provisionerType: string;
  artifact: { identity: string };
  componentArtifacts: [];
  admittedContext: OpenTofuAdmittedContext & {
    policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
  };
  provisionerPlan: KubernetesProvisionerPlanRef;
  provisionerApplyOutcome: OpenTofuApplyOutcome;
  foundationMigrationOutcome: FoundationMigrationOutcome;
};

export function createOpenTofuFoundationRecord(opts: {
  deployment: OpenTofuDeployment;
  deployRunId: string;
  artifactIdentity: string;
  admittedContext: OpenTofuFoundationRecord["admittedContext"];
  provisionerPlan: KubernetesProvisionerPlanRef;
  provisionerApplyOutcome: OpenTofuApplyOutcome;
  foundationMigrationOutcome: FoundationMigrationOutcome;
}): OpenTofuFoundationRecord {
  return {
    schemaVersion: OPENTOFU_FOUNDATION_RECORD_SCHEMA,
    deployRunId: opts.deployRunId,
    operationKind: "provision_only",
    runClassification: "provision_only",
    lifecycleState: "finished",
    finalOutcome:
      opts.provisionerApplyOutcome.status === "succeeded" &&
      opts.foundationMigrationOutcome.status === "succeeded"
        ? "succeeded"
        : "publish_failed",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    provider: "opentofu",
    providerTarget: opts.deployment.providerTarget,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    publisherType: "provision-only",
    provisionerType: opts.deployment.provisioner.type,
    artifact: { identity: opts.artifactIdentity },
    componentArtifacts: [],
    admittedContext: opts.admittedContext,
    provisionerPlan: opts.provisionerPlan,
    provisionerApplyOutcome: opts.provisionerApplyOutcome,
    foundationMigrationOutcome: opts.foundationMigrationOutcome,
  };
}

export async function writeOpenTofuFoundationRecord(
  recordsRoot: string,
  record: OpenTofuFoundationRecord,
): Promise<string> {
  const recordPath = path.join(path.resolve(recordsRoot), "runs", `${record.deployRunId}.json`);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
