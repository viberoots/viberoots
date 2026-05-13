#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { KubernetesDeployment } from "./contract";
import { withFailedStep } from "./deployment-failed-step";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
// prettier-ignore
import { classifySmokeRetry, noPublishAutoRetry, runWithAutomaticRetry } from "./deployment-retry-policy";
import { executionPolicyWithRetry, retryAuditFrom } from "./deployment-retry-records";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";
import type { AdmittedKubernetesComponentArtifact } from "./kubernetes-artifacts";
import { orderedComponentIds } from "./kubernetes-deploy-helpers";
import type { KubernetesAdmittedContext } from "./kubernetes-admission";
import { resolveKubernetesDeployAdmission } from "./kubernetes-deploy-admission";
import {
  prepareKubernetesPublisherConfig,
  type PreparedKubernetesPublisherConfig,
} from "./kubernetes-config";
import { publishKubernetesComponent } from "./kubernetes-publisher";
// prettier-ignore
import { publisherCredentialFields, resolveKubernetesPublishCredentialsForDeployment, type KubernetesPublishCredentialsHooks } from "./kubernetes-publish-credentials-orchestration";
// prettier-ignore
import { createKubernetesDeployRecord, createKubernetesDeployRunId, writeKubernetesDeployRecord, type KubernetesDeployRecord } from "./kubernetes-records";
import { createKubernetesDeployFailureRecord } from "./kubernetes-deploy-records";
import { writeKubernetesReplaySnapshot } from "./kubernetes-replay";
import { smokeKubernetesRelease } from "./kubernetes-smoke";
import { writeKubernetesProvisionerPlan } from "./kubernetes-provisioner-plan";
// prettier-ignore
import { maybeRunOpenTofuReviewedApply, type OpenTofuApplyHooks } from "./opentofu-apply-orchestration";

export async function submitKubernetesDeploy(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  componentArtifacts?: AdmittedKubernetesComponentArtifact[];
  admittedContext?: KubernetesAdmittedContext;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  openTofuApply?: OpenTofuApplyHooks;
  publishCredentials?: KubernetesPublishCredentialsHooks;
  preparedPublisherConfig?: PreparedKubernetesPublisherConfig;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: KubernetesDeployRecord; recordPath: string }> {
  const deployRunId = createKubernetesDeployRunId();
  const provisionerPlan = await writeKubernetesProvisionerPlan({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployRunId,
    deployment: opts.deployment,
  });
  const { admittedArtifacts, artifactsByComponent, compositeArtifactIdentity, admittedContext } =
    await resolveKubernetesDeployAdmission({
      ...opts,
      ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
    });
  const provisionerApplyOutcome = await maybeRunOpenTofuReviewedApply({
    deployment: opts.deployment,
    admittedContext,
    provisionerPlan,
    hooks: opts.openTofuApply,
  });
  const smokeMode = resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment });
  const deploymentMetadataFingerprint = deploymentMetadataFingerprintFor(opts.deployment);
  const componentResults: NonNullable<KubernetesDeployRecord["componentResults"]> = [];
  let executionPolicy = executionPolicyWithRetry({ budget: smokeMode.budget });
  let providerReleaseId = "";
  let providerConfigFingerprint = "";
  let preparedConfig: Awaited<ReturnType<typeof prepareKubernetesPublisherConfig>> | undefined;
  let publisherCredentials: Awaited<
    ReturnType<typeof resolveKubernetesPublishCredentialsForDeployment>
  > = { env: {}, envNames: [], contractRefs: [] };
  try {
    if (provisionerApplyOutcome?.status === "failed") {
      throw withFailedStep("publish", new Error("opentofu apply failed before kubernetes publish"));
    }
    preparedConfig =
      opts.preparedPublisherConfig ||
      (await prepareKubernetesPublisherConfig({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        componentArtifacts: Object.fromEntries(
          admittedArtifacts.map((artifact) => [
            artifact.componentId,
            { path: artifact.storedArtifactPath, identity: artifact.identity },
          ]),
        ),
        outputPath: path.join(
          opts.recordsRoot,
          "provider-config",
          `${deployRunId}.helm-values.json`,
        ),
      }));
    providerConfigFingerprint = preparedConfig.fingerprint;
    publisherCredentials = await resolveKubernetesPublishCredentialsForDeployment({
      deployment: opts.deployment,
      admittedContext,
      hooks: opts.publishCredentials,
    });
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
            publishCredentialEnv: publisherCredentials.env,
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
        liveDriftCheck: published.result.liveDriftCheck,
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
        provenancePath: artifact.provenancePath,
      })),
      componentResults,
      admittedContext,
      ...(opts.deployment.provisioner ? { provisionerType: opts.deployment.provisioner.type } : {}),
      ...(provisionerPlan ? { provisionerPlan } : {}),
      ...(provisionerApplyOutcome ? { provisionerApplyOutcome } : {}),
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
          provenancePath: artifact.provenancePath,
        })),
        admittedContext,
        providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
      }),
      publicUrl: smoke.result.publicUrl,
      ...(providerReleaseId ? { providerReleaseId } : {}),
      ...publisherCredentialFields(publisherCredentials),
    });
    return { record, recordPath: await writeKubernetesDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const record = createKubernetesDeployFailureRecord({
      deployment: opts.deployment,
      deployRunId,
      error,
      compositeArtifactIdentity,
      admittedArtifacts,
      componentResults,
      admittedContext,
      provisionerPlan,
      provisionerApplyOutcome,
      executionPolicy,
      deploymentMetadataFingerprint,
      providerConfigFingerprint,
      providerReleaseId,
      publisherCredentials,
    });
    const recordPath = await writeKubernetesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}
