#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { readCloudControlSetupInput } from "../../deployments/cloud-control-setup";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { viberootsRepoPath } from "./deployment-command";

test("setup and cutover entrypoints enforce generated ingress command evidence", () => {
  assert.match(
    validateCloudControlSetupInput(
      setupInput({ ingressCommandEvidence: ingressCommandEvidence({ tls: undefined }) }),
    ).join("\n"),
    /TLS command evidence is missing/i,
  );
  assert.match(
    validateCloudControlSetupInput(
      setupInput({ requireIngressCommandEvidence: true, ingressCommandEvidence: undefined }),
    ).join("\n"),
    /generated command evidence is missing/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ ingressCommandEvidence: undefined }),
      cutoverOpts(),
    ).errors.join("\n"),
    /generated command evidence is missing/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ ingressCommandEvidence: ingressCommandEvidence({ callback: badCallback() }) }),
      cutoverOpts(),
    ).errors.join("\n"),
    /callback command evidence host/,
  );
});

test("setup CLI reads generated ingress command evidence paths", () => {
  const previous = process.argv;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ingress-command-evidence-"));
  const topologyPath = path.join(tmp, "aws-topology-evidence.json");
  fs.writeFileSync(topologyPath, JSON.stringify(privateLinkAwsTopology()));
  const bundle = ingressCommandEvidence();
  const paths = Object.entries(bundle).map(([collector, payload]) => {
    const file = path.join(tmp, `${collector}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    return file;
  });
  try {
    process.argv = [
      "node",
      "deployment-control-plane",
      "setup",
      "--host-mode",
      "aws-ec2",
      "--aws-topology-evidence",
      topologyPath,
      "--ingress-command-evidence",
      paths.join(","),
    ];
    const input = readCloudControlSetupInput();
    assert.equal(input.requireIngressCommandEvidence, true);
    assert.equal((input.ingressCommandEvidence?.dns as any)?.collector, "dns");
  } finally {
    process.argv = previous;
  }
});

test("OpenTofu ingress source requires target registration certificate lifecycle and rollback shape", () => {
  const source = tfSource();
  for (const expected of [
    'resource "aws_lb_target_group_attachment" "control_plane"',
    "ingress_target_instance_id is required",
    "ingress_service_process is required",
    "ingress_certificate_not_before",
    "ingress_certificate_validation_ownership_reference",
    "ingress_certificate_renewal_reference",
    "ingress_certificate_dns_validation_reference",
    "ingress_target_health_status must come from collected evidence",
    "nonDestructive",
    "approvalRequiredForSharedResources",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
  assert.doesNotMatch(source, /status\s*=\s*"initial"/);
});

function setupInput(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE_REF,
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE_REF,
      sourceRevision: "source-entrypoint",
      imageBuildIdentity: IMAGE_BUILD_IDENTITY,
      digest: IMAGE_DIGEST,
      inspectedDigest: IMAGE_DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-entrypoint",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(IMAGE_REF, IMAGE_DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["sample-webapp-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: privateLinkSupabaseProfile(),
    ...overrides,
  };
}

function cutoverOpts() {
  return {
    operation: "cutover" as const,
    expectedHostProfile: "aws-ec2",
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    expectedRegion: "us-east-1",
    selectedCapabilities: ["aws-ec2-control-plane-host"],
    maxAgeMinutes: 60,
  };
}

function badCallback() {
  return {
    schemaVersion: "cloud-control-ingress-command-evidence@1",
    checkedAt: new Date().toISOString(),
    source: "generated-runbook-command",
    collector: "callback",
    inputs: ["aws-topology-evidence.json", "config.yaml"],
    evidence: {
      routeMatchesSelectedTargetGroup: true,
      callbackHostDigest: "sha256:wrong",
      callbackPath: "/oidc/callback",
      proofDigest: "sha256:callback-command",
    },
  };
}

function tfSource() {
  const moduleDir = path.join(
    viberootsRepoPath("."),
    "build-tools/deployments/aws-control-plane-foundation/opentofu",
  );
  return fs
    .readdirSync(moduleDir)
    .filter((file) => file.endsWith(".tf"))
    .map((file) => fs.readFileSync(path.join(moduleDir, file), "utf8"))
    .join("\n");
}
