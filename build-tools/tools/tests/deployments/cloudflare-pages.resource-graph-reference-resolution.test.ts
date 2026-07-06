#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeEvidenceValidationProof } from "../../deployments/resource-graph-runtime-reference";
import { runtimeEvidenceDocuments } from "../../deployments/resource-graph-runtime-evidence";
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
} from "../../deployments/resource-graph-types";

const deploymentId = "sample-webapp-staging";
const snapshot = {
  submissionId: "cp-runtime-evidence",
  executionSnapshotPath: "/control-plane/snapshots/cp-runtime-evidence.json",
};
const referenceCaseRows = [
  "runtimeInputs|cloud-control-runtime-input-reference@1|RuntimeInput|cloud-control-runtime-input@1",
  "authProviderProfiles|auth-provider-profile-reference@1|AuthProviderProfile|cloud-control-auth-provider-profile@1",
  "readinessEvidence|control-plane-readiness-reference@1|ControlPlaneReadinessEvidence|cloud-cutover-evidence@1",
  "observabilityEvidence|aws-ec2-control-plane-observability-reference@1|ControlPlaneObservabilityEvidence|aws-ec2-control-plane-observability@1",
  "miniMigrationEvidence|mini-migration-preflight-reference@1|MiniMigrationPreflightEvidence|mini-migration-preflight@1",
] as const;

test("runtime evidence references resolve through owning durable records", () => {
  for (const [key, refSchema, evidenceKind, evidenceSchema] of referenceCases()) {
    const valid = { [key]: [source("valid", reference(refSchema, key), [proofFor(key)])] };
    assert.equal(runtimeEvidenceDocuments(valid, { required: false }).length, 1);
    assertInvalidReference(key, refSchema, [], /durable evidence record is unresolved/);
    assertInvalidReference(
      key,
      refSchema,
      [{ ...proof(refSchema, evidenceKind, evidenceSchema, key), evidenceRef: "evidence://other" }],
      /durable evidence record is unresolved/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [proof(refSchema, evidenceKind, "wrong-schema", key)],
      /evidence schemaVersion mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [proof(refSchema, "WrongKind", evidenceSchema, key)],
      /validation proof kind mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [{ ...proof(refSchema, evidenceKind, evidenceSchema, key), deploymentId: "other" }],
      /deployment mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [
        {
          ...proof(refSchema, evidenceKind, evidenceSchema, key),
          validatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      /validation proof is stale/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [
        {
          ...proof(refSchema, evidenceKind, evidenceSchema, key),
          sourceSnapshot: { ...snapshot, submissionId: "other" },
        },
      ],
      /source snapshot mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [
        {
          ...proof(refSchema, evidenceKind, evidenceSchema, key),
          sourceSnapshot: { ...snapshot, executionSnapshotPath: "/other/snapshot.json" },
        },
      ],
      /execution snapshot mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [{ ...proof(refSchema, evidenceKind, evidenceSchema, key), provider: "gcp" }],
      /provider mismatch/,
    );
    assertInvalidReference(
      key,
      refSchema,
      [
        {
          ...proof(refSchema, evidenceKind, evidenceSchema, key),
          controlPlaneProfileId: "other-profile",
        },
      ],
      /control-plane profile mismatch/,
    );
  }
});

function assertInvalidReference(
  key: keyof DeploymentRuntimeInventorySources,
  schemaVersion: string,
  records: unknown[],
  error: RegExp,
) {
  assert.throws(
    () =>
      runtimeEvidenceDocuments(
        { [key]: [source("invalid", reference(schemaVersion, key), records)] },
        { required: false },
      ),
    error,
  );
}

function source(id: string, value: unknown, records: unknown[]) {
  return admitControlPlaneRuntimeRecord({
    id,
    refs: [deploymentId],
    value,
    validation: {
      expectedCallbackHost: "deploy-auth.example.test",
      expectedCallbackPath: "/oidc/callback",
      deploymentIds: [deploymentId],
      production: true,
      maxAgeMinutes: 60,
      nowMs: Date.now(),
      operation: "cutover",
      expectedProvider: "aws-ec2",
      expectedControlPlaneProfileId: "cloudflare-pages-control-plane",
      runtimeEvidenceRecords: records,
    },
  });
}

function reference(schemaVersion: string, name: string) {
  const evidenceRef = `evidence://control-plane/cloudflare-pages/snapshots/${snapshot.submissionId}/${name}`;
  return {
    schemaVersion,
    checkedAt: new Date().toISOString(),
    evidenceRef,
    provider: "aws-ec2",
    controlPlaneProfileId: "cloudflare-pages-control-plane",
    operation: name === "readinessEvidence" ? "cutover" : undefined,
    sourceSnapshot: snapshot,
  };
}

function referenceCases() {
  return referenceCaseRows.map((row) => row.split("|")) as Array<
    [keyof DeploymentRuntimeInventorySources, string, string, string]
  >;
}

function evidenceKindFor(name: string) {
  return referenceCases().find(([key]) => key === name)?.[2] || "RuntimeInput";
}

function evidenceSchemaFor(name: string) {
  return referenceCases().find(([key]) => key === name)?.[3] || "cloud-control-runtime-input@1";
}

function proof(
  referenceSchemaVersion: string,
  evidenceKind: string,
  evidenceSchemaVersion: string,
  name: string,
) {
  return runtimeEvidenceValidationProof({
    evidenceKind,
    evidenceSchemaVersion,
    referenceSchemaVersion,
    evidenceRef: `evidence://control-plane/cloudflare-pages/snapshots/${snapshot.submissionId}/${name}`,
    deploymentId,
    sourceSnapshot: snapshot,
    checkedAt: new Date().toISOString(),
    provider: "aws-ec2",
    controlPlaneProfileId: "cloudflare-pages-control-plane",
  });
}

function proofFor(name: string) {
  return proof(referenceSchemaFor(name), evidenceKindFor(name), evidenceSchemaFor(name), name);
}

function referenceSchemaFor(name: string) {
  return (
    referenceCases().find(([key]) => key === name)?.[1] || "cloud-control-runtime-input-reference@1"
  );
}
