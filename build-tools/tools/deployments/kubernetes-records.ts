#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { KubernetesAdmittedContext } from "./kubernetes-admission.ts";
import type { KubernetesDeployment } from "./contract.ts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeOutcome,
} from "./deployment-smoke-policy.ts";
import {
  kubernetesRunnerIdentities,
  type DeploymentRunnerIdentities,
} from "./deployment-runner-identities.ts";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan.ts";
import type { OpenTofuApplyOutcome } from "./opentofu-apply.ts";
import { KUBERNETES_PROVIDER } from "./contract.ts";
import { operatorErrorFields } from "./deployment-control-plane-redaction.ts";

export const KUBERNETES_RECORD_SCHEMA = "deploy-record@2026-04-10";

export type KubernetesDeployRecord = {
  schemaVersion: typeof KUBERNETES_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback" | "provision_only";
  runClassification: "deploy" | "promotion" | "retry" | "rollback" | "provision_only";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof KUBERNETES_PROVIDER;
  providerTarget: KubernetesDeployment["providerTarget"];
  providerTargetIdentity: string;
  controlPlane?: {
    submissionId: string;
    workerId: string;
    admission: "admitted";
    lockScope: string;
    submissionPath?: string;
    executionSnapshotPath?: string;
  };
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  artifact?: { identity: string };
  componentArtifacts: Array<{ componentId: string; identity: string; storedArtifactPath: string }>;
  componentResults?: Array<{
    componentId: string;
    artifactIdentity: string;
    providerTargetIdentity: string;
    finalOutcome: "succeeded" | "publish_failed";
  }>;
  admittedContext: KubernetesAdmittedContext;
  runnerIdentities: DeploymentRunnerIdentities;
  publisherType: string;
  provisionerType?: string;
  provisionerPlan?: KubernetesProvisionerPlanRef;
  provisionerApplyOutcome?: OpenTofuApplyOutcome;
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  executionPolicy?: DeploymentExecutionPolicyFacts;
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  publicUrl?: string;
  providerReleaseId?: string;
  failedStep?: "publish" | "smoke";
  error?: string;
  errorFingerprint?: string;
};

export function createKubernetesDeployRunId(): string {
  return `deploy-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createKubernetesDeployRecord(
  deployment: KubernetesDeployment,
  outcome: Omit<
    KubernetesDeployRecord,
    | "schemaVersion"
    | "deploymentId"
    | "deploymentLabel"
    | "provider"
    | "providerTarget"
    | "providerTargetIdentity"
    | "publisherType"
  >,
): KubernetesDeployRecord {
  return {
    schemaVersion: KUBERNETES_RECORD_SCHEMA,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: KUBERNETES_PROVIDER,
    providerTarget: deployment.providerTarget,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    runnerIdentities: kubernetesRunnerIdentities(deployment),
    publisherType: deployment.publisher.type,
    ...outcome,
    ...operatorErrorFields(outcome.error),
  };
}

export async function writeKubernetesDeployRecord(
  recordsRoot: string,
  record: KubernetesDeployRecord,
): Promise<string> {
  const recordPath = path.join(path.resolve(recordsRoot), "runs", `${record.deployRunId}.json`);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
