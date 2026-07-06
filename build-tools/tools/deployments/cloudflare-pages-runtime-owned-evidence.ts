#!/usr/bin/env zx-wrapper
import { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-alarms";
import { defaultReviewedRuntimeInput } from "./cloud-control-runtime-input";
import { cloudflarePagesReadinessEvidence } from "./cloudflare-pages-runtime-readiness-evidence";

const tables = [
  "submissions",
  "queue",
  "control_plane_audit_events",
  "current_stage_state",
  "deploy_records",
  "idempotency",
] as const;

export function cloudflareOwnedRuntimeEvidence(opts: {
  evidenceKind: string;
  deploymentId: string;
  checkedAt: string;
}) {
  return withAuthority(evidenceFor(opts), opts);
}

function evidenceFor(opts: { evidenceKind: string; deploymentId: string; checkedAt: string }) {
  if (opts.evidenceKind === "RuntimeInput") return runtimeInput(opts.deploymentId);
  if (opts.evidenceKind === "AuthProviderProfile") {
    return runtimeInput(opts.deploymentId).authProvider;
  }
  if (opts.evidenceKind === "ControlPlaneObservabilityEvidence") {
    return observability(opts.checkedAt);
  }
  if (opts.evidenceKind === "MiniMigrationPreflightEvidence") {
    return miniMigration(opts.checkedAt);
  }
  if (opts.evidenceKind === "ControlPlaneReadinessEvidence") {
    return cloudflarePagesReadinessEvidence(opts.deploymentId, opts.checkedAt);
  }
  throw new Error(`unsupported runtime evidence kind ${opts.evidenceKind}`);
}

function withAuthority(
  value: Record<string, unknown>,
  opts: { evidenceKind: string; deploymentId: string; checkedAt: string },
) {
  return {
    ...value,
    evidenceKind: opts.evidenceKind,
    deploymentId: opts.deploymentId,
    deploymentIds: [opts.deploymentId],
    checkedAt: opts.checkedAt,
    owningProvider: "aws-ec2",
    owningControlPlaneProfileId: "cloudflare-pages-control-plane",
    validatedBy: "cloudflare-pages-control-plane-reconciler",
    validationStatus: "passed",
  };
}

function runtimeInput(deploymentId: string) {
  return defaultReviewedRuntimeInput({
    publicUrl: "https://deploy.example.test",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    deploymentIds: [deploymentId],
    supabaseProjectRef: "project-review",
    supabaseConnectionMode: "public",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    awsVpcId: "vpc-123",
    artifactCredentialMode: "files",
  });
}

function observability(checkedAt: string) {
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt,
    provider: "aws-ec2",
    logSink: { kind: "cloudwatch", retentionDays: 30, accessControlDigest: "sha256:log-access" },
    unitLogRouting: { api: "deployment-control-plane-api.service" },
    history: { readiness: true, workerHeartbeat: true },
    alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({
      id,
      target: `alarm-${id}`,
      action: "notify",
    })),
  };
}

function miniMigration(checkedAt: string) {
  return {
    schemaVersion: "mini-migration-preflight@1",
    checkedAt,
    stateSync: { status: "passed", checkedAt },
    restore: { status: "passed", checkedAt, evidenceRef: "evidence://mini-migration/restore" },
    rollback: { status: "passed", checkedAt, evidenceRef: "evidence://mini-migration/rollback" },
    migratedRows: Object.fromEntries(tables.map((table) => [table, 1])),
  };
}
