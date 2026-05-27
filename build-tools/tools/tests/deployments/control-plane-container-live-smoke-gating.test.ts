#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { ProviderCapabilityDeclaration } from "../../deployments/cloud-control-setup-types";
import {
  authValidationInputs,
  liveSmokeEnv,
  validateLiveControlPlaneSmoke,
} from "./control-plane-container-live-smoke.helpers";
import {
  awsTopologyInputs,
  validateAwsProviderCapabilityEvidence,
  validateAwsRuntimeEvidenceFiles,
} from "./control-plane-container-live-smoke-aws.helpers";
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
    awsTopologyInputs({ VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY: "1" } as NodeJS.ProcessEnv),
    [
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
    { VBR_CONTROL_PLANE_LIVE_SMOKE: "1", VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER: "workos" },
    () => {
      assert.throws(
        () => liveSmokeEnv({ skip: () => assert.fail("enabled live smoke must not skip") }),
        /VBR_CONTROL_PLANE_LIVE_STAGING_DEPLOY_SMOKE_COMMAND.*VBR_CONTROL_PLANE_LIVE_WORKOS_JWKS_URL/s,
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
  const capabilities = [
    {
      id: "aws-ec2-control-plane-host",
      auditEvidence: ["aws-runtime-db", "aws-runtime-s3", "aws-shutdown"],
    },
    { id: "unrelated-provider", auditEvidence: ["unrelated"] },
  ] as ProviderCapabilityDeclaration[];
  await assert.rejects(
    () =>
      validateAwsProviderCapabilityEvidence(env, capabilities, {
        "aws-ec2-control-plane-host": ["aws-runtime-db"],
      }),
    /aws-ec2-control-plane-host evidence must reference/,
  );
  await assert.rejects(
    () =>
      validateAwsProviderCapabilityEvidence(env, capabilities, {
        "unrelated-provider": [
          env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE,
          env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE,
          env.VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE,
        ],
      }),
    /aws-ec2-control-plane-host evidence must reference/,
  );
  await validateAwsProviderCapabilityEvidence(env, capabilities, {
    "aws-ec2-control-plane-host": [
      env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE,
      env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE,
      env.VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE,
    ],
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
