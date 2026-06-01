#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { ProviderCapabilityDeclaration } from "../../deployments/cloud-control-setup-types";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import {
  authValidationInputs,
  cutoverValidationInputs,
  liveSmokeEnv,
  validateLiveControlPlaneSmoke,
} from "./control-plane-container-live-smoke.helpers";
import {
  awsTopologyInputs,
  validateAwsProviderCapabilityEvidence,
  validateAwsRuntimeEvidenceFiles,
} from "./control-plane-container-live-smoke-aws.helpers";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { awsEc2HookProfile } from "./cloud-control-aws-ec2-hook-profile.fixture";
import { writeAwsRuntimeEvidence } from "./control-plane-container-live-smoke-fixtures.helpers";

function withEnv(env: Record<string, string>, fn: () => void) {
  const previous = { ...process.env };
  try {
    process.env = { ...previous, ...env };
    fn();
  } finally {
    process.env = previous;
  }
}

test("enabled live smoke requires staging, auth, topology, and capability evidence inputs", () => {
  assert.deepEqual(authValidationInputs("workos"), ["VBR_CONTROL_PLANE_LIVE_WORKOS_JWKS_URL"]);
  assert.deepEqual(authValidationInputs("supabase-auth"), [
    "VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_HEALTH_URL",
    "VBR_CONTROL_PLANE_LIVE_SUPABASE_AUTH_JWKS_URL",
  ]);
  assert.deepEqual(authValidationInputs("generic-oidc"), [
    "VBR_CONTROL_PLANE_LIVE_OIDC_DISCOVERY_URL",
  ]);
  assert.deepEqual(
    cutoverValidationInputs({ VBR_CONTROL_PLANE_LIVE_CUTOVER: "1" } as NodeJS.ProcessEnv),
    [
      "VBR_CONTROL_PLANE_LIVE_CUTOVER_BUNDLE_DIR",
      "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_HOST_PROFILE",
      "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_IMAGE_BUILD_IDENTITY",
      "VBR_CONTROL_PLANE_LIVE_CUTOVER_EXPECTED_REGION",
      "VBR_CONTROL_PLANE_LIVE_CUTOVER_SELECTED_CAPABILITIES",
    ],
  );
  assert.deepEqual(
    awsTopologyInputs({ VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY: "1" } as NodeJS.ProcessEnv),
    [
      "VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_EC2_PROFILE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_SECURITY_GROUP_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_DNS_TLS_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_INGRESS_URL",
      "VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH",
      "VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH",
      "VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE",
      "VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE",
    ],
  );
  withEnv(
    {
      VBR_CONTROL_PLANE_LIVE_SMOKE: "1",
      VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER: "workos",
      VBR_CONTROL_PLANE_LIVE_CUTOVER: "1",
    },
    () => {
      assert.throws(
        () => liveSmokeEnv({ skip: () => assert.fail("enabled live smoke must not skip") }),
        /VBR_CONTROL_PLANE_LIVE_STAGING_DEPLOY_SMOKE_COMMAND.*VBR_CONTROL_PLANE_LIVE_WORKOS_JWKS_URL.*VBR_CONTROL_PLANE_LIVE_CUTOVER_BUNDLE_DIR/s,
      );
    },
  );
});

test("AWS runtime topology evidence rejects arbitrary command-style proof", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-aws-runtime-evidence-"));
  const dbFile = path.join(tmp, "db.json");
  const s3File = path.join(tmp, "s3.json");
  const shutdownFile = path.join(tmp, "shutdown.json");
  await fsp.writeFile(dbFile, JSON.stringify({ command: "true", success: true }));
  await fsp.writeFile(s3File, JSON.stringify({ command: "true", success: true }));
  await fsp.writeFile(shutdownFile, JSON.stringify({ command: "true", success: true }));
  await assert.rejects(
    () =>
      validateAwsRuntimeEvidenceFiles({
        VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE: dbFile,
        VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE: s3File,
        VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE: shutdownFile,
        VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH: "privatelink",
        VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH: "gateway",
      }),
    /Postgres runtime is required/,
  );
});

test("AWS runtime topology evidence validates selected DB and S3 paths", async () => {
  const env = await writeAwsRuntimeEvidence();
  await validateAwsRuntimeEvidenceFiles(env);
  await assert.rejects(
    () =>
      validateAwsRuntimeEvidenceFiles({
        ...env,
        VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH: "public",
        VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH: "interface",
      }),
    /Expected values to be strictly equal/,
  );
});

test("AWS runtime topology evidence ties DB, S3, and shutdown to same runtime identities", async () => {
  const env = await writeAwsRuntimeEvidence({ mismatchedS3Worker: true });
  await assert.rejects(() => validateAwsRuntimeEvidenceFiles(env), /processId must match/);
  const shutdownEnv = await writeAwsRuntimeEvidence({ mismatchedShutdownWorker: true });
  await assert.rejects(() => validateAwsRuntimeEvidenceFiles(shutdownEnv), /Expected values/);
});

test("AWS runtime topology evidence is attached to provider capabilities", async () => {
  const env = await writeAwsRuntimeEvidence();
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-ec2-control-plane-host",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: publicAwsTopology(),
    awsEc2Profile: awsEc2HookProfile(),
  });
  const capabilities = [hook.declaration] as ProviderCapabilityDeclaration[];
  const completeEvidence = {
    ...hook,
    auditEvidence: [
      ...hook.auditEvidence,
      env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE,
      env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE,
      env.VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE,
    ],
  };
  await assert.rejects(
    () =>
      validateAwsProviderCapabilityEvidence(env, capabilities, {
        "aws-ec2-control-plane-host": {
          ...completeEvidence,
          auditEvidence: [
            ...hook.auditEvidence,
            env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE,
          ],
        },
      }),
    /aws-ec2-control-plane-host evidence must reference/,
  );
  await assert.rejects(
    () =>
      validateAwsProviderCapabilityEvidence(env, capabilities, {
        "aws-ec2-control-plane-host": {
          ...completeEvidence,
          providerPayload: {
            ...(completeEvidence.providerPayload as any),
            identity: {
              ...((completeEvidence.providerPayload as any).identity as Record<string, unknown>),
              privateSubnetIds: ["subnet-unreviewed"],
            },
          },
        },
      }),
    /privateSubnetIds do not match selected topology/,
  );
  await assert.rejects(
    () =>
      validateAwsProviderCapabilityEvidence(env, capabilities, {
        "aws-ec2-control-plane-host": {
          ...completeEvidence,
          providerPayload: {
            ...(completeEvidence.providerPayload as Record<string, unknown>),
            ec2HostMode: "repo-owned-asg",
          },
        },
      }),
    /EC2 host mode does not match/,
  );
  await validateAwsProviderCapabilityEvidence(env, capabilities, {
    "aws-ec2-control-plane-host": completeEvidence,
  });
});

test("AWS subnet and security-group evidence must include runtime instances", async () => {
  const env = await writeAwsRuntimeEvidence({ omitRuntimeTopology: true });
  await assert.rejects(() => validateAwsRuntimeEvidenceFiles(env), /missing from subnet evidence/);
});

test("optional live container smoke validates non-production cloud topology", async (t) => {
  const env = liveSmokeEnv(t);
  if (!env) return;
  await validateLiveControlPlaneSmoke(env);
});
