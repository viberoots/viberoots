#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { exec as execCallback } from "node:child_process";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRunbookStructure } from "../../deployments/cloud-control-runbook";
import { RUNTIME_HTTP_SCHEMA } from "../../deployments/cloud-control-runtime-http-evidence";
import { runInScratchTemp } from "../lib/test-helpers";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ingressEvidence } from "./cloud-control-aws-ingress.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { writeBundle } from "./cloud-control-setup-doctor.helpers";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = `sha256:${"b".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"c".repeat(64)}`;
const exec = promisify(execCallback);

test("generated HTTP commands emit consumable runtime evidence envelopes", () => {
  const bundle = renderCloudControlSetupBundle(input());
  const commands = JSON.parse(bundle.files["commands.json"]!);
  assert.deepEqual(validateRunbookStructure(commands), []);
  assert.match(runbookCommand(commands, "health").command, /cloud-control-runtime-http-evidence@1/);
  assert.match(runbookCommand(commands, "readiness").command, /dependencies/);
  assert.match(runbookCommand(commands, "worker-heartbeats").command, /tokenFile/);
  assert.match(runbookCommand(commands, "worker-heartbeats").command, /profileIdentity/);
  assert.match(
    runbookCommand(commands, "worker-heartbeats").command,
    /\/api\/v1\/worker-heartbeats/,
  );
  assert.match(
    runbookCommand(commands, "health").command,
    /PROFILE_ROOT="\$\{PROFILE_ROOT:-\$\(pwd\)\}"/,
  );
  assert.doesNotMatch(JSON.stringify(commands), /<control-plane-service-url>|token-value/);
  assert.match(runbookCommand(commands, "database").command, /managed-dependencies/);
  assert.match(runbookCommand(commands, "artifact-store").mustPass, /PUT, GET, HEAD/);
  assert.match(runbookCommand(commands, "database").command, /managed-dependencies\.profile\.yaml/);
  assert.match(bundle.files["config.yaml"]!, /workers:\n  expectedCount: 2/);
  const checklist = JSON.parse(bundle.files["conformance-checklist.json"]!);
  assert.deepEqual(
    checklist.requiredChecks.map((check: { name: string }) => check.name),
    [
      "image-publication",
      "health",
      "readiness",
      "worker-heartbeats",
      "database",
      "artifact-store",
      "provider-capabilities",
    ],
  );
});

test("generated HTTP commands write parseable runtime evidence artifacts", async () => {
  await runInScratchTemp("cloud-control-runbook-http-artifacts", async (tmp) => {
    await withRuntimeServer(async (publicUrl) => {
      const bundle = renderCloudControlSetupBundle(input(publicUrl));
      const commands = JSON.parse(bundle.files["commands.json"]!);
      await writeBundle(tmp, bundle.files);
      const credentialDir = path.join(tmp, "credentials");
      await fsp.mkdir(credentialDir, { recursive: true });
      await fsp.writeFile(path.join(credentialDir, "control-plane-token"), "runtime-token\n");
      for (const id of ["health", "readiness", "worker-heartbeats"]) {
        await exec(runbookCommand(commands, id).command, {
          cwd: tmp,
          env: { ...process.env, CREDENTIAL_DIR: credentialDir },
        });
      }
      for (const file of [
        "http-health.json",
        "http-readiness.json",
        "http-worker-heartbeats.json",
      ]) {
        const text = await fsp.readFile(path.join(tmp, file), "utf8");
        assert.doesNotMatch(text, /runtime-token|Bearer\s+/);
        assertHttpEnvelope(JSON.parse(text), publicUrl, file);
      }
    });
  });
});

function input(publicUrl = "https://deploy.example.test") {
  return {
    outDir: "unused",
    mode: "aws-ec2" as const,
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command" as const,
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl,
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3" as const,
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh" as const,
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForPublishedImage(topology(publicUrl), DIGEST_REF, DIGEST),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
  };
}

function topology(publicUrl: string) {
  if (publicUrl === "https://deploy.example.test") return privateLinkAwsTopology();
  return privateLinkAwsTopology({ ingress: localIngress(publicUrl) });
}

function localIngress(publicUrl: string) {
  const base = ingressEvidence();
  const hostname = new URL(publicUrl).hostname;
  return {
    ...base,
    publicUrl,
    dnsRecord: hostname,
    certificate: {
      ...(base as any).certificate,
      subjectAlternativeNames: [hostname, "deploy-auth.example.test"],
    },
    dns: { ...(base as any).dns, hostname },
  };
}

function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((command: any) => command.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}

async function withRuntimeServer(callback: (publicUrl: string) => Promise<void>) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    response.setHeader("content-type", "application/json");
    if (pathname === "/healthz")
      return response.end(JSON.stringify({ ok: true, instanceId: "i-0abc1234" }));
    if (pathname === "/readyz") return response.end(JSON.stringify(readinessBody()));
    if (pathname === "/api/v1/worker-heartbeats") {
      assert.equal(request.headers.authorization, "Bearer runtime-token");
      return response.end(JSON.stringify({ workers: ["worker-1", "worker-2"].map(worker) }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server port unavailable");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function assertHttpEnvelope(value: any, publicUrl: string, file: string) {
  const check = file === "http-worker-heartbeats.json" ? "worker-heartbeats" : file.slice(5, -5);
  assert.equal(value.schemaVersion, RUNTIME_HTTP_SCHEMA);
  assert.equal(value.check, check);
  assert.equal(value.status.ok, true);
  assert.equal(value.status.httpStatus, 200);
  assert.ok(Date.parse(value.checkedAt));
  assert.equal(value.host, new URL(value.url).host);
  assert.equal(value.expected.host, new URL(publicUrl).host);
  assert.equal(value.expected.hostProfile, "aws-ec2");
  assert.equal(value.expected.profileIdentity, "i-0abc1234");
  assert.deepEqual(value.expected.deploymentIds, ["pleomino-staging"]);
  assert.equal(value.expected.workerCount, 2);
  assert.ok(value.body && typeof value.body === "object");
  if (check === "worker-heartbeats") assert.equal(value.credentialSource.kind, "token_file");
  else assert.equal(value.credentialSource.kind, "none");
  if (check === "readiness") {
    assert.equal(value.dependencies.runtimeConfig.profileIdentity, "i-0abc1234");
    assert.deepEqual(value.dependencies.runtimeConfig, value.body.runtimeConfig);
  }
}

function readinessBody() {
  return {
    ok: true,
    database: { ok: true },
    artifactStore: { ok: true },
    workerQueueLocks: { ok: true },
    runtimeConfig: { ok: true, profileIdentity: "i-0abc1234" },
  };
}

function worker(workerId: string) {
  return {
    workerId,
    instanceId: "i-0abc1234",
    status: "running",
    lastSeenAt: new Date().toISOString(),
  };
}
