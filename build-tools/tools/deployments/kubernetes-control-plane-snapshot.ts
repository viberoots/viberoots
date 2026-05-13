#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract";
import {
  admitProviderControlPlaneSnapshot,
  type FrozenProviderSnapshotFields,
} from "./deployment-provider-frozen-snapshot";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import {
  resolveInitialKubernetesAdmittedContext,
  resolvePromotionKubernetesAdmittedContext,
  resolveSourceRunKubernetesAdmittedContext,
} from "./kubernetes-admission";
import { admitKubernetesComponentArtifacts } from "./kubernetes-artifacts";
import type { AdmittedKubernetesComponentArtifact } from "./kubernetes-artifacts";
import { requiredArtifactPaths } from "./kubernetes-deploy-helpers";
import { resolveKubernetesReplaySource, type KubernetesReplaySnapshot } from "./kubernetes-replay";
import type { KubernetesControlPlaneSubmitRequest } from "./kubernetes-control-plane";
import { writeKubernetesProvisionerPlan } from "./kubernetes-provisioner-plan";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";

export type KubernetesControlPlaneSnapshot = FrozenProviderSnapshotFields & {
  schemaVersion: "kubernetes-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: KubernetesControlPlaneSubmitRequest["operationKind"];
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: KubernetesDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  componentArtifacts?: AdmittedKubernetesComponentArtifact[];
  replaySnapshot?: KubernetesReplaySnapshot;
  sourceRecord?: any;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  smokeConnectOverride?: unknown;
};

export async function buildKubernetesControlPlaneSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
}): Promise<KubernetesControlPlaneSnapshot> {
  const base = baseSnapshot(opts);
  const replay = isReplay(opts.request) ? await resolveReplay(opts) : {};
  const componentArtifacts =
    opts.request.operationKind === "deploy"
      ? await admitKubernetesComponentArtifacts({
          recordsRoot: opts.recordsRoot,
          artifactPathsByComponentId: requiredArtifactPaths(
            opts.request.deployment,
            opts.request.artifactDir,
            opts.request.artifactDirsByComponentId,
          ),
        })
      : (replay as { componentArtifacts?: AdmittedKubernetesComponentArtifact[] })
          .componentArtifacts;
  const artifactLineageId =
    (replay as any).artifactLineageId ||
    (componentArtifacts
      ? compositeIdentity(opts.request.deployment, componentArtifacts)
      : `provision-only:${opts.request.deployment.providerTarget.providerTargetIdentity}`);
  const provisionerPlan = await admissionProvisionerPlan(opts);
  const admittedContext = await admittedContextFor({
    ...opts,
    replay,
    artifactLineageId,
  });
  return {
    ...base,
    ...(componentArtifacts ? { componentArtifacts } : {}),
    ...replay,
    ...(await admitProviderControlPlaneSnapshot({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind: opts.request.operationKind as any,
      admittedContext,
      sourceRecord: (replay as any).sourceRecord,
      artifactLineageId,
      evidence: {
        ...((opts.request.admissionEvidence as any) || {}),
        ...(provisionerPlan ? { provisionerPlanFingerprint: provisionerPlan.fingerprint } : {}),
      },
    })),
  };
}

function isReplay(request: KubernetesControlPlaneSubmitRequest) {
  return ["promotion", "retry", "rollback"].includes(request.operationKind);
}

function compositeIdentity(
  deployment: KubernetesDeployment,
  artifacts: AdmittedKubernetesComponentArtifact[],
) {
  return fingerprintValue({
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    componentArtifacts: artifacts.map((artifact) => ({
      componentId: artifact.componentId,
      identity: artifact.identity,
    })),
  });
}

function baseSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
}) {
  const { request } = opts;
  return {
    schemaVersion: "kubernetes-control-plane-snapshot@1" as const,
    submissionId: request.submissionId,
    submittedAt: request.submittedAt,
    operationKind: request.operationKind,
    deploymentId: request.deployment.deploymentId,
    deploymentLabel: request.deployment.label,
    providerTargetIdentity: request.deployment.providerTarget.providerTargetIdentity,
    lockScope: request.deployment.providerTarget.providerTargetIdentity,
    deployment: request.deployment,
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    ...(request.expectedSourceRevision
      ? { expectedSourceRevision: request.expectedSourceRevision }
      : {}),
    ...(request.sourceRunId ? { sourceRunId: request.sourceRunId } : {}),
    ...(request.smokeConnectOverride ? { smokeConnectOverride: request.smokeConnectOverride } : {}),
  };
}

async function admissionProvisionerPlan(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
}) {
  if (opts.request.operationKind !== "deploy" && opts.request.operationKind !== "provision_only") {
    return undefined;
  }
  return await writeKubernetesProvisionerPlan({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployRunId: `${opts.request.submissionId}-admission`,
    deployment: opts.request.deployment,
  });
}

async function resolveReplay(opts: {
  recordsRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
}) {
  const source = await resolveKubernetesReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: String(opts.request.sourceRunId || ""),
  });
  return {
    componentArtifacts: source.replaySnapshot.componentArtifacts,
    replaySnapshot: source.replaySnapshot,
    sourceRecord: source.record,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifactIdentity,
  };
}

async function admittedContextFor(opts: {
  workspaceRoot: string;
  request: KubernetesControlPlaneSubmitRequest;
  replay: Record<string, any>;
  artifactLineageId: string;
}) {
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(
    opts.request.admissionEvidence,
  );
  const common = {
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.request.deployment,
    artifactIdentity: opts.artifactLineageId,
    ...(opts.request.expectedSourceRevision
      ? { expectedSourceRevision: opts.request.expectedSourceRevision }
      : {}),
    ...(requestedReviewedSource?.ref ? { requestedSourceRef: requestedReviewedSource.ref } : {}),
  };
  if (opts.request.operationKind === "promotion") {
    return await resolvePromotionKubernetesAdmittedContext({
      ...common,
      sourceRecord: opts.replay.sourceRecord,
    });
  }
  if (opts.request.operationKind === "retry" || opts.request.operationKind === "rollback") {
    return await resolveSourceRunKubernetesAdmittedContext({
      ...common,
      sourceRecord: opts.replay.sourceRecord,
    });
  }
  return await resolveInitialKubernetesAdmittedContext(common);
}
