#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { KubernetesDeployment } from "./contract.ts";
import { withFailedStep } from "./deployment-failed-step.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import {
  classifySmokeRetry,
  noPublishAutoRetry,
  runWithAutomaticRetry,
} from "./deployment-retry-policy.ts";
import { executionPolicyWithRetry, retryAuditFrom } from "./deployment-retry-records.ts";
import {
  deploymentMetadataFingerprintFor,
  fingerprintValue,
} from "./nixos-shared-host-deployment-fingerprint.ts";
import { admitKubernetesComponentArtifacts } from "./kubernetes-artifacts.ts";
import {
  artifactByComponentId,
  orderedComponentIds,
  requiredArtifactPaths,
} from "./kubernetes-deploy-helpers.ts";
import { resolveInitialKubernetesAdmittedContext } from "./kubernetes-admission.ts";
import { prepareKubernetesPublisherConfig } from "./kubernetes-config.ts";
import { publishKubernetesComponent } from "./kubernetes-publisher.ts";
import {
  createKubernetesDeployRecord,
  createKubernetesDeployRunId,
  writeKubernetesDeployRecord,
  type KubernetesDeployRecord,
} from "./kubernetes-records.ts";
import { writeKubernetesReplaySnapshot } from "./kubernetes-replay.ts";
import { smokeKubernetesRelease } from "./kubernetes-smoke.ts";
import { writeKubernetesProvisionerPlan } from "./kubernetes-provisioner-plan.ts";

export async function submitKubernetesDeploy(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: KubernetesDeployRecord; recordPath: string }> {
  const deployRunId = createKubernetesDeployRunId();
  const admittedArtifacts = await admitKubernetesComponentArtifacts({
    recordsRoot: opts.recordsRoot,
    artifactPathsByComponentId: requiredArtifactPaths(
      opts.deployment,
      opts.artifactDir,
      opts.artifactDirsByComponentId,
    ),
  });
  const artifactsByComponent = artifactByComponentId(admittedArtifacts);
  const compositeArtifactIdentity = fingerprintValue({
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    componentArtifacts: admittedArtifacts.map((artifact) => ({
      componentId: artifact.componentId,
      identity: artifact.identity,
    })),
  });
  const admittedContext = await resolveInitialKubernetesAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: compositeArtifactIdentity,
  });
  const provisionerPlan = await writeKubernetesProvisionerPlan({
    recordsRoot: opts.recordsRoot,
    deployRunId,
    deployment: opts.deployment,
  });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: "deploy",
    admittedContext,
    artifactLineageId: compositeArtifactIdentity,
    evidence: {
      ...(opts.admissionEvidence || {}),
      ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
    },
  });
  const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const componentResults: NonNullable<KubernetesDeployRecord["componentResults"]> = [];
  let executionPolicy = executionPolicyWithRetry({ budget: smokeMode.budget });
  let providerReleaseId = "";
  let providerConfigFingerprint = "";
  let preparedConfig: Awaited<ReturnType<typeof prepareKubernetesPublisherConfig>> | undefined;
  try {
    preparedConfig = await prepareKubernetesPublisherConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      componentArtifacts: Object.fromEntries(
        admittedArtifacts.map((artifact) => [
          artifact.componentId,
          { path: artifact.storedArtifactPath, identity: artifact.identity },
        ]),
      ),
      outputPath: path.join(opts.recordsRoot, "provider-config", `${deployRunId}.helm-values.json`),
    });
    providerConfigFingerprint = preparedConfig.fingerprint;
    for (const componentId of orderedComponentIds(opts.deployment)) {
      const artifact = artifactsByComponent[componentId];
      const published = await runWithAutomaticRetry({
        step: "publish",
        run: async () =>
          await publishKubernetesComponent({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            chart: preparedConfig.chart,
            renderedConfigPath: preparedConfig.renderedConfigPath,
            componentId,
            artifactPath: artifact.storedArtifactPath,
          }),
        classifyError: () => noPublishAutoRetry(),
      }).catch((error) => {
        executionPolicy = executionPolicyWithRetry({
          budget: smokeMode.budget,
          prior: executionPolicy,
          retryAudit: retryAuditFrom(error),
        });
        throw withFailedStep("publish", error);
      });
      executionPolicy = executionPolicyWithRetry({
        budget: smokeMode.budget,
        prior: executionPolicy,
        retryAudit: published.audit,
      });
      providerReleaseId = published.result.providerReleaseId;
      componentResults.push({
        componentId,
        artifactIdentity: artifact.identity,
        providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
        finalOutcome: "succeeded",
      });
    }
    const smoke = await runWithAutomaticRetry({
      step: "smoke",
      totalBudgetMs: smokeMode.budget.totalBudgetMs,
      run: async () =>
        await smokeKubernetesRelease({
          smokeUrl: preparedConfig.smokeUrl,
          expectedContent: preparedConfig.smokeExpectContains,
          connectOverride: opts.smokeConnectOverride,
        }),
      classifyError: classifySmokeRetry,
    }).catch((error) => {
      executionPolicy = executionPolicyWithRetry({
        budget: smokeMode.budget,
        prior: executionPolicy,
        retryAudit: retryAuditFrom(error),
      });
      throw withFailedStep("smoke", error);
    });
    executionPolicy = executionPolicyWithRetry({
      budget: smokeMode.budget,
      prior: executionPolicy,
      retryAudit: smoke.audit,
    });
    const record = createKubernetesDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      artifact: { identity: compositeArtifactIdentity },
      componentArtifacts: admittedArtifacts.map((artifact) => ({
        componentId: artifact.componentId,
        identity: artifact.identity,
        storedArtifactPath: artifact.storedArtifactPath,
      })),
      componentResults,
      admittedContext,
      ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
      ...(provisionerPlan ? { provisionerPlan } : {}),
      smokeOutcome: "passed",
      executionPolicy,
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      replaySnapshotPath: await writeKubernetesReplaySnapshot({
        recordsRoot: opts.recordsRoot,
        deployRunId,
        deployment: opts.deployment,
        artifactIdentity: compositeArtifactIdentity,
        componentArtifacts: admittedArtifacts.map((artifact) => ({
          componentId: artifact.componentId,
          identity: artifact.identity,
          storedArtifactPath: artifact.storedArtifactPath,
        })),
        admittedContext,
        providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
      }),
      publicUrl: smoke.result.publicUrl,
      ...(providerReleaseId ? { providerReleaseId } : {}),
    });
    return { record, recordPath: await writeKubernetesDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const record = createKubernetesDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome:
        (error as any)?.failedStep === "smoke" ? "smoke_failed_after_publish" : "publish_failed",
      artifact: { identity: compositeArtifactIdentity },
      componentArtifacts: admittedArtifacts.map((artifact) => ({
        componentId: artifact.componentId,
        identity: artifact.identity,
        storedArtifactPath: artifact.storedArtifactPath,
      })),
      ...(componentResults.length > 0 ? { componentResults } : {}),
      admittedContext,
      ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
      ...(provisionerPlan ? { provisionerPlan } : {}),
      executionPolicy,
      deploymentMetadataFingerprint,
      ...(providerConfigFingerprint ? { providerConfigFingerprint } : {}),
      failedStep: (error as any)?.failedStep === "smoke" ? "smoke" : "publish",
      error: error instanceof Error ? error.message : String(error),
      ...(providerReleaseId ? { providerReleaseId } : {}),
    });
    const recordPath = await writeKubernetesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}
