#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolvePromotionKubernetesAdmittedContext,
  resolveSourceRunKubernetesAdmittedContext,
} from "./kubernetes-admission.ts";
import { prepareKubernetesPublisherConfig } from "./kubernetes-config.ts";
import type { KubernetesDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";
import { publishKubernetesComponent } from "./kubernetes-publisher.ts";
import { createKubernetesDeployRecord, writeKubernetesDeployRecord } from "./kubernetes-records.ts";
import { writeKubernetesReplaySnapshot } from "./kubernetes-replay.ts";
import { smokeKubernetesRelease } from "./kubernetes-smoke.ts";

type SourceRecordLike = { deployRunId: string; deploymentId: string; admittedContext?: any };

export async function submitKubernetesExactArtifactRun(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  operationKind: "promotion" | "retry" | "rollback";
  componentArtifacts: Array<{ componentId: string; identity: string; storedArtifactPath: string }>;
  sourceRecord: SourceRecordLike;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: { protocol: "http:" | "https:"; hostname: string; port: number };
}) {
  const admittedContext =
    opts.operationKind === "promotion"
      ? await resolvePromotionKubernetesAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifactLineageId,
          sourceRecord: opts.sourceRecord,
        })
      : await resolveSourceRunKubernetesAdmittedContext({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          artifactIdentity: opts.artifactLineageId,
          sourceRecord: opts.sourceRecord,
        });
  admittedContext.policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    admittedContext,
    sourceRecord: opts.sourceRecord as any,
    artifactLineageId: opts.artifactLineageId,
    evidence: opts.admissionEvidence,
  });
  const deployRunId = `deploy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  try {
    const preparedConfig = await prepareKubernetesPublisherConfig({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      componentArtifacts: Object.fromEntries(
        opts.componentArtifacts.map((artifact) => [
          artifact.componentId,
          { path: artifact.storedArtifactPath, identity: artifact.identity },
        ]),
      ),
      outputPath: path.join(opts.recordsRoot, "provider-config", `${deployRunId}.helm-values.json`),
    });
    for (const artifact of opts.componentArtifacts) {
      await publishKubernetesComponent({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        chart: preparedConfig.chart,
        renderedConfigPath: preparedConfig.renderedConfigPath,
        componentId: artifact.componentId,
        artifactPath: artifact.storedArtifactPath,
      });
    }
    const smoke = await smokeKubernetesRelease({
      smokeUrl: preparedConfig.smokeUrl,
      expectedContent: preparedConfig.smokeExpectContains,
      connectOverride: opts.smokeConnectOverride,
    });
    const replaySnapshotPath = await writeKubernetesReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId,
      deployment: opts.deployment,
      artifactIdentity: opts.artifactLineageId,
      componentArtifacts: opts.componentArtifacts,
      admittedContext,
      providerConfigSnapshotPath: preparedConfig.renderedConfigPath,
    });
    const record = createKubernetesDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      artifact: { identity: opts.artifactLineageId },
      componentArtifacts: opts.componentArtifacts,
      componentResults: opts.componentArtifacts.map((artifact) => ({
        componentId: artifact.componentId,
        artifactIdentity: artifact.identity,
        providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
        finalOutcome: "succeeded",
      })),
      admittedContext,
      smokeOutcome: "passed",
      deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
      providerConfigFingerprint: preparedConfig.fingerprint,
      replaySnapshotPath,
      publicUrl: smoke.publicUrl,
    });
    return { record, recordPath: await writeKubernetesDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const record = createKubernetesDeployRecord(opts.deployment, {
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "publish_failed",
      parentRunId: opts.parentRunId,
      releaseLineageId: opts.releaseLineageId,
      artifactLineageId: opts.artifactLineageId,
      artifact: { identity: opts.artifactLineageId },
      componentArtifacts: opts.componentArtifacts,
      admittedContext,
      deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
      failedStep: "publish",
      error: error instanceof Error ? error.message : String(error),
    });
    const recordPath = await writeKubernetesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}
