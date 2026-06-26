#!/usr/bin/env zx-wrapper
import type {
  DeploymentDriftStatus,
  DeploymentRetainedArtifactEvidence,
  DeploymentRetainedRenderEvidence,
  DeploymentStageRequiredCheck,
} from "./deployment-current-stage-state-types";
import { redactOperatorText } from "./deployment-control-plane-redaction";

type CheckLike = {
  name?: string;
  status?: string;
  reporterIdentity?: string;
  reportingKind?: string;
  recordRef?: string;
};

type StageStateRecordExtras = {
  replaySnapshotPath?: string;
  providerConfigSnapshotPath?: string;
  provisionerPlan?: { artifactPath?: string; fingerprint?: string };
  artifact?: { identity?: string; storedArtifactPath?: string; provenancePath?: string };
  artifactIdentity?: string;
  componentArtifacts?: Array<{
    identity?: string;
    storedArtifactPath?: string;
    provenancePath?: string;
  }>;
  controlPlane?: { executionSnapshotPath?: string };
  driftStatus?: DeploymentDriftStatus;
  admittedContext?: {
    policyEvaluation?: {
      requiredChecks?: CheckLike[];
      checks?: CheckLike[];
    };
  };
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function secretSafeStageStateValue(value: string): string {
  const visible = redactOperatorText(value);
  return visible?.redacted ? visible.summary : value;
}

function requiredCheckFrom(check: CheckLike): DeploymentStageRequiredCheck | undefined {
  const name = clean(check.name);
  if (!name) return undefined;
  return {
    name: secretSafeStageStateValue(name),
    ...(clean(check.status) ? { status: secretSafeStageStateValue(clean(check.status)) } : {}),
    ...(clean(check.reporterIdentity || check.reportingKind)
      ? {
          reporterIdentity: secretSafeStageStateValue(
            clean(check.reporterIdentity || check.reportingKind),
          ),
        }
      : {}),
    ...(clean(check.recordRef)
      ? { recordRef: secretSafeStageStateValue(clean(check.recordRef)) }
      : {}),
  };
}

function evidence(
  kind: DeploymentRetainedRenderEvidence["kind"],
  referencePath?: string,
  fingerprint?: string,
): DeploymentRetainedRenderEvidence | undefined {
  const ref = clean(referencePath);
  if (!ref) return undefined;
  return {
    kind,
    referencePath: ref,
    ...(clean(fingerprint) ? { fingerprint: secretSafeStageStateValue(clean(fingerprint)) } : {}),
  };
}

function driftStatusFrom(record: StageStateRecordExtras): DeploymentDriftStatus {
  const drift = record.driftStatus || { state: "not_checked" as const };
  return {
    state: drift.state,
    ...(clean(drift.checkedAt)
      ? { checkedAt: secretSafeStageStateValue(clean(drift.checkedAt)) }
      : {}),
    ...(clean(drift.summary) ? { summary: secretSafeStageStateValue(clean(drift.summary)) } : {}),
    ...(clean(drift.fingerprint)
      ? { fingerprint: secretSafeStageStateValue(clean(drift.fingerprint)) }
      : {}),
  };
}

function artifactEvidence(record: StageStateRecordExtras): DeploymentRetainedArtifactEvidence[] {
  return [
    {
      identity: record.artifact?.identity || record.artifactIdentity,
      storedArtifactPath: record.artifact?.storedArtifactPath,
      provenancePath: record.artifact?.provenancePath,
    },
    ...(record.componentArtifacts || []),
  ]
    .map((artifact) => {
      const identity = clean(artifact.identity);
      if (!identity) return undefined;
      const storedArtifactPath = clean(artifact.storedArtifactPath);
      const provenancePath = clean(artifact.provenancePath);
      if (!storedArtifactPath && !provenancePath) return undefined;
      return {
        identity: secretSafeStageStateValue(identity),
        ...(storedArtifactPath ? { storedArtifactPath } : {}),
        ...(provenancePath ? { provenancePath } : {}),
      };
    })
    .filter((entry): entry is DeploymentRetainedArtifactEvidence => Boolean(entry));
}

export function currentStageStateExtras(record: StageStateRecordExtras): {
  requiredChecks: DeploymentStageRequiredCheck[];
  retainedRenderEvidence: DeploymentRetainedRenderEvidence[];
  retainedArtifactEvidence: DeploymentRetainedArtifactEvidence[];
  driftStatus: DeploymentDriftStatus;
} {
  const policy = record.admittedContext?.policyEvaluation;
  return {
    requiredChecks: (policy?.requiredChecks || policy?.checks || [])
      .map(requiredCheckFrom)
      .filter((check): check is DeploymentStageRequiredCheck => Boolean(check)),
    retainedRenderEvidence: [
      evidence("replay_snapshot", record.replaySnapshotPath),
      evidence("provider_config", record.providerConfigSnapshotPath),
      evidence(
        "provisioner_plan",
        record.provisionerPlan?.artifactPath,
        record.provisionerPlan?.fingerprint,
      ),
      evidence("execution_snapshot", record.controlPlane?.executionSnapshotPath),
    ].filter((entry): entry is DeploymentRetainedRenderEvidence => Boolean(entry)),
    retainedArtifactEvidence: artifactEvidence(record),
    driftStatus: driftStatusFrom(record),
  };
}
