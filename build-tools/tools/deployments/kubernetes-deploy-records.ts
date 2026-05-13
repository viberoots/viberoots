#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract";
import type { KubernetesAdmittedContext } from "./kubernetes-admission";
import type { AdmittedKubernetesComponentArtifact } from "./kubernetes-artifacts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan";
import type { OpenTofuApplyOutcome } from "./opentofu-apply";
import { createKubernetesDeployRecord, type KubernetesDeployRecord } from "./kubernetes-records";
import { publisherCredentialFields } from "./kubernetes-publish-credentials-orchestration";
import type { KubernetesPublishCredentials } from "./kubernetes-publish-credentials";

function failedStep(error: unknown): "publish" | "smoke" {
  return (error as { failedStep?: string } | null)?.failedStep === "smoke" ? "smoke" : "publish";
}

export function createKubernetesDeployFailureRecord(opts: {
  deployment: KubernetesDeployment;
  deployRunId: string;
  error: unknown;
  compositeArtifactIdentity: string;
  admittedArtifacts: AdmittedKubernetesComponentArtifact[];
  componentResults: NonNullable<KubernetesDeployRecord["componentResults"]>;
  admittedContext: KubernetesAdmittedContext;
  provisionerPlan: KubernetesProvisionerPlanRef | undefined;
  provisionerApplyOutcome: OpenTofuApplyOutcome | undefined;
  executionPolicy: DeploymentExecutionPolicyFacts;
  deploymentMetadataFingerprint: string;
  providerConfigFingerprint: string;
  providerReleaseId: string;
  publisherCredentials: KubernetesPublishCredentials;
}): KubernetesDeployRecord {
  const step = failedStep(opts.error);
  return createKubernetesDeployRecord(opts.deployment, {
    deployRunId: opts.deployRunId,
    operationKind: "deploy",
    runClassification: "deploy",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: step === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
    artifact: { identity: opts.compositeArtifactIdentity },
    componentArtifacts: opts.admittedArtifacts.map((artifact) => ({
      componentId: artifact.componentId,
      identity: artifact.identity,
      storedArtifactPath: artifact.storedArtifactPath,
      provenancePath: artifact.provenancePath,
    })),
    ...(opts.componentResults.length > 0 ? { componentResults: opts.componentResults } : {}),
    admittedContext: opts.admittedContext,
    ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
    ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
    ...(opts.provisionerApplyOutcome
      ? { provisionerApplyOutcome: opts.provisionerApplyOutcome }
      : {}),
    executionPolicy: opts.executionPolicy,
    deploymentMetadataFingerprint: opts.deploymentMetadataFingerprint,
    ...(opts.providerConfigFingerprint
      ? { providerConfigFingerprint: opts.providerConfigFingerprint }
      : {}),
    failedStep: step,
    error: opts.error instanceof Error ? opts.error.message : String(opts.error),
    ...(opts.providerReleaseId ? { providerReleaseId: opts.providerReleaseId } : {}),
    ...publisherCredentialFields(opts.publisherCredentials),
  });
}
