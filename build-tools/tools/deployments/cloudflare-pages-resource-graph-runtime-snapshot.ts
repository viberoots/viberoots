#!/usr/bin/env zx-wrapper
import { cloudflareOwnedRuntimeEvidence } from "./cloudflare-pages-runtime-owned-evidence";
import { snapshotRuntimeEvidenceReference } from "./cloudflare-pages-resource-graph-runtime-reference";
import type {
  DeploymentRuntimeInventorySources,
  RuntimeSourceRecord,
} from "./resource-graph-types";
import type { RuntimeEvidenceDurableRecord } from "./resource-graph-runtime-reference";

type SnapshotDoc = {
  deploymentId?: string;
  operationKind?: string;
  resourceGraphRuntimeEvidenceSources?: DeploymentRuntimeInventorySources;
  resourceGraphRuntimeEvidenceRecords?: RuntimeEvidenceDurableRecord[];
};

export function withCloudflarePagesRuntimeEvidenceSources<T extends SnapshotDoc>(snapshot: T): T {
  const deploymentId = String(snapshot.deploymentId || "");
  const submissionId = String(
    (snapshot as any).submissionId || snapshot.operationKind || "snapshot",
  );
  const submittedAt = String((snapshot as any).submittedAt || new Date().toISOString());
  const durableRecords: RuntimeEvidenceDurableRecord[] = [];
  const source = (
    kind: string,
    value: unknown,
    evidenceKind: string,
    evidenceSchemaVersion: string,
    operation = "deploy",
  ) => {
    const reference = snapshotRuntimeEvidenceReference({
      value,
      kind,
      submissionId,
      deploymentId,
      evidenceKind,
      evidenceSchemaVersion,
      ownedEvidence: cloudflareOwnedRuntimeEvidence({
        evidenceKind,
        deploymentId,
        checkedAt: submittedAt,
      }),
    });
    durableRecords.push(reference.durableRecord);
    return runtimeRecord(
      `${kind}:${submissionId}`,
      deploymentId,
      submittedAt,
      reference.value,
      operation,
    );
  };
  return {
    ...snapshot,
    resourceGraphRuntimeEvidenceSources:
      snapshot.operationKind === "rollback"
        ? rollbackSources(source, submittedAt)
        : deploySources(source, submittedAt),
    resourceGraphRuntimeEvidenceRecords: durableRecords,
  };
}

function deploySources(source: EvidenceSourceBuilder, submittedAt: string) {
  return {
    runtimeInputs: [
      source(
        "runtime-input",
        reference("cloud-control-runtime-input-reference@1", "runtime-input", submittedAt),
        "RuntimeInput",
        "cloud-control-runtime-input@1",
      ),
    ],
    authProviderProfiles: [
      source(
        "auth-profile",
        reference("auth-provider-profile-reference@1", "auth-provider", submittedAt),
        "AuthProviderProfile",
        "cloud-control-auth-provider-profile@1",
      ),
    ],
  };
}

function rollbackSources(source: EvidenceSourceBuilder, submittedAt: string) {
  return {
    readinessEvidence: [
      source(
        "cutover-readiness",
        reference("control-plane-readiness-reference@1", "readiness", submittedAt),
        "ControlPlaneReadinessEvidence",
        "cloud-cutover-evidence@1",
        "cutover",
      ),
    ],
    observabilityEvidence: [
      source(
        "observability",
        reference("aws-ec2-control-plane-observability-reference@1", "observability", submittedAt),
        "ControlPlaneObservabilityEvidence",
        "aws-ec2-control-plane-observability@1",
      ),
    ],
    miniMigrationEvidence: [
      source(
        "mini-migration",
        reference("mini-migration-preflight-reference@1", "mini-migration", submittedAt),
        "MiniMigrationPreflightEvidence",
        "mini-migration-preflight@1",
      ),
    ],
  };
}

type EvidenceSourceBuilder = (
  kind: string,
  value: unknown,
  evidenceKind: string,
  evidenceSchemaVersion: string,
  operation?: string,
) => RuntimeSourceRecord;

function runtimeRecord(
  id: string,
  deploymentId: string,
  checkedAt: string,
  value: unknown,
  operation: string,
) {
  return {
    id,
    refs: [deploymentId],
    value,
    validation: {
      expectedCallbackHost: "deploy-auth.example.test",
      expectedCallbackPath: "/oidc/callback",
      deploymentIds: [deploymentId],
      production: true,
      maxAgeMinutes: 60,
      nowMs: Date.parse(checkedAt) + 1000,
      operation,
      expectedProvider: "aws-ec2",
      expectedControlPlaneProfileId: "cloudflare-pages-control-plane",
    },
  };
}

function reference(schemaVersion: string, kind: string, checkedAt: string) {
  return {
    schemaVersion,
    checkedAt,
    provider: "aws-ec2",
    operation: kind === "readiness" ? "cutover" : undefined,
  };
}
