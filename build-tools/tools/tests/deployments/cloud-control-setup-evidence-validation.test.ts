#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";

const DIGEST = `sha256:${"e".repeat(64)}`;
const IMAGE = `registry.example.com/platform/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"f".repeat(64)}`;

test("AWS setup validation rejects dashboard notes and secret-looking evidence", () => {
  const dashboardOnly = validateCloudControlSetupInput(
    input({ awsTopology: privateLinkAwsTopology({ dashboardNotes: "dashboard-only green" }) }),
  ).join("\n");
  assert.match(dashboardOnly, /dashboard\/raw-IaC notes/);
  const secret = validateCloudControlSetupInput(
    input({
      awsTopology: privateLinkAwsTopology({
        commandOutput: "aws_secret_access_key=abcdef0123456789abcdef0123",
      }),
    }),
  ).join("\n");
  assert.match(secret, /secret material/);
});

test("AWS setup validation rejects truthy topology placeholders", () => {
  assert.match(
    validateCloudControlSetupInput(input({ awsTopology: true as any })).join("\n"),
    /not literal true/,
  );
  assert.match(
    validateCloudControlSetupInput(input({ awsTopology: {} as any })).join("\n"),
    /missing or empty/,
  );
});

test("AWS setup validation rejects wrong runtime ingress callback wiring", () => {
  const topology = privateLinkAwsTopology({
    ingress: {
      ...(privateLinkAwsTopology() as any).ingress,
      callbackRoute: {
        ...(privateLinkAwsTopology() as any).ingress.callbackRoute,
        host: "wrong.example.test",
      },
    },
  });
  assert.match(
    validateCloudControlSetupInput(input({ awsTopology: topology })).join("\n"),
    /callback route host/,
  );
});

test("AWS setup validates generated ingress command evidence when supplied", () => {
  assert.doesNotMatch(
    validateCloudControlSetupInput(
      input({ ingressCommandEvidence: ingressCommandEvidence() }),
    ).join("\n"),
    /ingress .*command evidence/i,
  );
  assert.match(
    validateCloudControlSetupInput(
      input({ ingressCommandEvidence: ingressCommandEvidence({ dns: undefined }) }),
    ).join("\n"),
    /DNS command evidence is missing/i,
  );
});

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE,
      sourceRevision: "source-setup-evidence",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-setup-evidence",
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
    awsTopology: privateLinkAwsTopology(),
    ...overrides,
  };
}
