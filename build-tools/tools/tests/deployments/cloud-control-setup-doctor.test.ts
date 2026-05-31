#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import {
  runCredentialRotation,
  runCredentialStaging,
} from "../../deployments/control-plane-credential-staging";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  managedDependencyEvidence,
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-cutover-fixture";
import { liveCredentialStagingEvidence } from "./cloud-control-credential-staging.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import {
  phase,
  resolveCommandRef,
  runbookCommand,
  writeBundle,
  writeEvidence,
  writeSupabaseProviderEvidence,
} from "./cloud-control-setup-doctor.helpers";
const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DIGEST = `sha256:${"c".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("setup doctor classifies local runbook phases without cloud credentials", async () => {
  await runInScratchTemp("cloud-control-setup-doctor", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input({ outDir: tmp }));
    await writeBundle(tmp, bundle.files);
    const commands = JSON.parse(bundle.files["commands.json"]!);
    const managedCommand = runbookCommand(commands, "database").command;
    assert.match(managedCommand, /deployment-control-plane managed-dependencies/);
    assert.ok(commands.phases.every((entry: any) => entry.evidenceInputs.length > 0));
    assert.match(JSON.stringify(commands.phases), /supabase-managed-postgres/);

    const before = await validateRunbookBundle(tmp);
    assert.equal(before.structureErrors.length, 0);
    assert.equal(phase(before, "local-review").status, "ready");
    assert.equal(phase(before, "credential-preflight").status, "blocked");
    assert.equal(phase(before, "managed-dependencies").status, "blocked");

    await fsp.writeFile(path.join(tmp, "setup-doctor.json"), '{"ok":true}\n', "utf8");
    await writeLiveCredentialInputs(tmp);
    const afterDoctor = await validateRunbookBundle(tmp);
    assert.equal(phase(afterDoctor, "credential-preflight").status, "ready");

    await fsp.writeFile(path.join(tmp, "credential-preflight.json"), '{"ok":true}\n', "utf8");
    const staging = await runCredentialStaging({
      bundleDir: tmp,
      out: path.join(tmp, "credential-staging.json"),
    });
    await writeLiveCredentialStagingOutput(tmp, staging);
    await runCredentialRotation({
      bundleDir: tmp,
      applyRotation: true,
      out: path.join(tmp, "credential-rotation.json"),
      rotatedMapOut: path.join(tmp, "credential-map.rotated.json"),
    });
    await writeSupabaseProviderEvidence(tmp);
    await fsp.writeFile(
      path.join(tmp, "managed-dependency-evidence.json"),
      JSON.stringify(managedDependencyEvidence()),
      "utf8",
    );
    await validateRunbookBundle(tmp);

    for (const id of [
      "supabase-privatelink-support-initiation",
      "supabase-privatelink-ram-acceptance",
      "supabase-privatelink-vpc-lattice",
      "supabase-privatelink-private-dns",
      "supabase-privatelink-tcp-5432-sg",
      "supabase-privatelink-private-psql",
    ]) {
      await writeEvidence(tmp, runbookCommand(commands, id).outputs[0]);
    }
    const after = await validateRunbookBundle(tmp);
    assert.equal(phase(after, "managed-dependencies").status, "complete");
    assert.equal(phase(after, "process-start").status, "ready");
    assert.equal(phase(after, "http-validation").status, "blocked");

    for (const id of ["service", "worker-1", "worker-2"]) {
      await writeEvidence(tmp, runbookCommand(commands, id).outputs[0]);
    }
    const afterProcess = await validateRunbookBundle(tmp);
    assert.equal(phase(afterProcess, "process-start").status, "complete");
    assert.equal(phase(afterProcess, "http-validation").status, "ready");

    for (const id of [
      "ingress-dns",
      "ingress-tls",
      "ingress-health",
      "ingress-callback",
      "health",
      "readiness",
      "worker-heartbeats",
    ]) {
      await writeEvidence(tmp, runbookCommand(commands, id).outputs[0]);
    }
    const afterHttp = await validateRunbookBundle(tmp);
    assert.equal(phase(afterHttp, "http-validation").status, "complete");
  });
});

test("setup doctor rejects invalid generated auth and credential artifacts", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-invalid-artifacts", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input({ outDir: tmp }));
    await writeBundle(tmp, bundle.files);
    const auth = JSON.parse(bundle.files["auth-provider-profile.json"]!);
    auth.metadata.jwksCheckedAt = "2020-01-01T00:00:00.000Z";
    await fsp.writeFile(path.join(tmp, "auth-provider-profile.json"), JSON.stringify(auth));
    const credentialMap = JSON.parse(bundle.files["credential-map.json"]!);
    credentialMap.entries[0].source = { kind: "secret-backend-ref" };
    await fsp.writeFile(path.join(tmp, "credential-map.json"), JSON.stringify(credentialMap));
    await fsp.writeFile(
      path.join(tmp, "residual-action-checklist.json"),
      JSON.stringify({ schemaVersion: "cloud-control-residual-actions@1", actions: [{}] }),
    );

    const result = await validateRunbookBundle(tmp);
    assert.equal(result.ok, false);
    assert.match(result.structureErrors.join("\n"), /auth-provider-profile\.json.*JWKS/);
    assert.match(result.structureErrors.join("\n"), /credential-map\.json.*secret backend ref/);
    assert.match(result.structureErrors.join("\n"), /actions\[0\] missing id/);
    assert.match(result.structureErrors.join("\n"), /typed evidence requirements/);
  });
});

test("conformance checklist command refs resolve into generated commands", () => {
  const bundle = renderCloudControlSetupBundle(input());
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const checklist = JSON.parse(bundle.files["conformance-checklist.json"]!);
  const expectedIds: Record<string, string> = {
    health: "health",
    readiness: "readiness",
    "worker-heartbeats": "worker-heartbeats",
    database: "database",
    "artifact-store": "artifact-store",
  };
  for (const check of checklist.requiredChecks) {
    const expectedId = expectedIds[check.name];
    if (!expectedId) continue;
    assert.equal(
      resolveCommandRef(check.commandRef, commands),
      runbookCommand(commands, expectedId).command,
    );
  }
});

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForImage(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}

async function writeLiveCredentialInputs(tmp: string): Promise<void> {
  await fsp.writeFile(path.join(tmp, "live-infisical-backend.profile.json"), "{}\n", "utf8");
  await fsp.writeFile(path.join(tmp, "live-host-verifier.profile.json"), "{}\n", "utf8");
}

async function writeLiveCredentialStagingOutput(tmp: string, staging: any): Promise<void> {
  await writeLiveCredentialInputs(tmp);
  const manifest = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-manifest.json"), "utf8"),
  );
  const credentialMap = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"),
  );
  await fsp.writeFile(
    path.join(tmp, "credential-staging.live.json"),
    JSON.stringify(
      liveCredentialStagingEvidence(staging.manifestDigest, staging.credentialMapDigest, {
        requiredFiles: manifest.requiredFiles,
        credentialMap,
      }),
      null,
      2,
    ),
    "utf8",
  );
}

function topologyForImage() {
  return topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST);
}
