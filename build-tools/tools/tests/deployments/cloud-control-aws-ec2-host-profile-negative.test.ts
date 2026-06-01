#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRenderedProfile } from "../../deployments/cloud-control-setup-profile-validate";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { ec2HostProfileInput as input } from "./cloud-control-aws-ec2-host-profile.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

test("AWS EC2 host profile validation rejects AMI pin and network placement gaps", () => {
  assertRejects({ compute: { amiBuildIdentity: "" } }, /missing AMI build identity/);
  assertRejects({ compute: { instanceType: "" } }, /missing instanceType/);
  assertRejects(
    { compute: { amiSelection: { pinPath: "latest-marketplace-alias" } } },
    /reviewed NixOS build\/import.*selected AMI id.*mutable marketplace/s,
  );
  assertRejects({ compute: { launchTemplateSubnetIds: [] } }, /selected private subnet placement/);
  assertRejects(
    { compute: { launchTemplateSubnetIds: ["subnet-public"] } },
    /not selected in reviewed foundation topology/,
  );
  assertRejects({ compute: { securityGroupIds: ["sg-service"] } }, /missing selected worker group/);
});

test("AWS EC2 host profile validation rejects host posture and bootstrap gaps", () => {
  assertRejects({ compute: { ebs: { encrypted: false } } }, /EBS evidence/);
  assertRejects({ compute: { recovery: {} } }, /recovery profile.*lease\/fencing/s);
  assertRejects(
    { compute: { access: { mode: "reviewed-ssh-break-glass", broadInboundSsh: true } } },
    /SSH access is too broad/,
  );
  assertRejects(
    { compute: { userData: { activatesGeneratedArtifacts: true, providerMutation: true } } },
    /user data must only activate generated artifacts/,
  );
  assertRejects({ compute: { patchCadence: { hostImage: "" } } }, /host image.*container image/);
});

test("AWS EC2 host profile validation rejects runtime proof and observability gaps", () => {
  assertRejects({ compute: { registryPullProof: { hostProfile: "laptop" } } }, /pull proof/);
  assert.match(
    validateAwsTopologyEvidence(privateLinkAwsTopology(), {
      maxAgeMinutes: 60,
      expectedImage: "registry.example.com/other/app@sha256:bbbb",
      expectedImageDigest: `sha256:${"b".repeat(64)}`,
    }).join("\n"),
    /pull proof image does not match.*pull proof digest does not match/s,
  );
  const otherDigest = `sha256:${"b".repeat(64)}`;
  const otherImage = `registry.example.com/platform/deployment-control-plane@${otherDigest}`;
  const setupErrors = validateCloudControlSetupInput(
    input({
      image: otherImage,
      imagePublication: {
        ...input().imagePublication!,
        image: otherImage,
        digest: otherDigest,
        inspectedDigest: otherDigest,
        registryProfile: ecrRegistryProfileForImage(otherImage, otherDigest),
      },
    }),
  ).join("\n");
  assert.match(setupErrors, /pull proof image does not match.*pull proof digest does not match/s);
  assertRejects(
    { compute: { processEvidence: { imageDigest: `sha256:${"b".repeat(64)}` } } },
    /process evidence image digest does not match selected digest/,
  );
  assertRejects(
    { compute: { processEvidence: { workers: ["pid:101"], configDigest: "sha256:x" } } },
    /at least two worker.*imageDigest.*credentialManifestDigest.*serviceReadiness/s,
  );
  assertRejects(
    {
      operationalVisibility: {
        logSink: {},
        unitLogRouting: {},
        history: {},
        alarms: [{ id: "service-down", target: "sns" }],
      },
    },
    /log sink.*unit log routing.*readiness.*missing alarm readiness-failure/s,
  );
});

test("AWS EC2 generated entrypoint artifacts reject missing worker units and writable credentials", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  const missingWorker = { ...files };
  delete missingWorker["systemd/deployment-control-plane-worker-2.service"];
  assert.match(
    validateRenderedProfile(missingWorker).join("\n"),
    /deployment-control-plane-worker-2 missing generated systemd unit/,
  );

  const writableCredentials = {
    ...files,
    "systemd/deployment-control-plane-worker-1.service": files[
      "systemd/deployment-control-plane-worker-1.service"
    ]!.replace(
      "/run/deployment-control-plane/credentials:/run/deployment-control-plane/credentials:ro",
      "/run/deployment-control-plane/credentials:/run/deployment-control-plane/credentials:rw",
    ),
  };
  assert.match(
    validateRenderedProfile(writableCredentials).join("\n"),
    /deployment-control-plane-worker-1\.service credential mount must be read-only/,
  );

  const staleMountWiring = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "bind-mounted-credential-directory",
      "load-credential",
    ),
  };
  assert.match(
    validateRenderedProfile(staleMountWiring).join("\n"),
    /AWS profile credential mount wiring is stale/,
  );
});

test("AWS EC2 generated entrypoint artifacts reject loopback service or worker ingress", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  const loopbackService = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "bindHost: 0.0.0.0",
      "bindHost: 127.0.0.1",
    ),
    "systemd/deployment-control-plane-service.service": files[
      "systemd/deployment-control-plane-service.service"
    ]!.replace("--publish 0.0.0.0:7780:7780", "--publish 127.0.0.1:7780:7780"),
  };
  assert.match(
    validateRenderedProfile(loopbackService).join("\n"),
    /service ingress bind must be load-balancer reachable/,
  );

  const workerPublished = {
    ...files,
    "systemd/deployment-control-plane-worker-1.service": files[
      "systemd/deployment-control-plane-worker-1.service"
    ]!.replace("--user 10001:10001", "--user 10001:10001 --publish 0.0.0.0:7780:7780"),
  };
  assert.match(
    validateRenderedProfile(workerPublished).join("\n"),
    /worker unit must not publish ingress ports/,
  );
});

test("AWS EC2 generated profile rejects stale instance-profile artifact IAM binding", () => {
  const files = renderCloudControlSetupBundle(
    input({
      artifactCredentialMode: "aws-instance-profile",
      artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      runtimeInput: reviewedRuntimeInput({ artifactCredentialMode: "aws-instance-profile" }),
    }),
  ).files;
  const wrongRole = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "roleArn: arn:aws:iam::123456789012:role/control-plane-host",
      "roleArn: arn:aws:iam::123456789012:role/control-plane-unused",
    ),
  };
  assert.match(
    validateRenderedProfile(wrongRole).join("\n"),
    /artifact IAM binding role does not match reviewed role/,
  );

  const wrongExpectedRole = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "expectedRoleArn: arn:aws:iam::123456789012:role/control-plane-host",
      "expectedRoleArn: arn:aws:iam::123456789012:role/control-plane-unused",
    ),
  };
  assert.match(
    validateRenderedProfile(wrongExpectedRole).join("\n"),
    /artifact IAM binding expected role does not match reviewed role/,
  );

  const wrongProfile = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "instanceProfileArn: arn:aws:iam::123456789012:instance-profile/control-plane",
      "instanceProfileArn: arn:aws:iam::123456789012:instance-profile/unused",
    ),
  };
  assert.match(
    validateRenderedProfile(wrongProfile).join("\n"),
    /artifact IAM binding instance profile does not match compute profile/,
  );

  const missingPolicy = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "- sha256:artifact-policy",
      "[]",
    ),
  };
  assert.match(
    validateRenderedProfile(missingPolicy).join("\n"),
    /artifact IAM binding missing attached artifact policy digest/,
  );

  const wrongBindingPolicy = {
    ...files,
    "aws-ec2-profile.yaml": files["aws-ec2-profile.yaml"]!.replace(
      "policyDigests:\n      - sha256:artifact-policy\n    leastPrivilegePolicyDigest: sha256:artifact-policy",
      "policyDigests:\n      - sha256:artifact-policy\n    leastPrivilegePolicyDigest: sha256:unused-artifact-policy",
    ),
  };
  assert.match(
    validateRenderedProfile(wrongBindingPolicy).join("\n"),
    /artifact IAM binding least-privilege policy does not match reviewed policy/,
  );
});

function assertRejects(overrides: Record<string, any>, pattern: RegExp): void {
  const topology = privateLinkAwsTopology() as any;
  const next = {
    ...topology,
    ...overrides,
    compute: { ...topology.compute, ...(overrides.compute || {}) },
    operationalVisibility: {
      ...topology.operationalVisibility,
      ...(overrides.operationalVisibility || {}),
    },
  };
  assert.match(validateCloudControlSetupInput(input({ awsTopology: next })).join("\n"), pattern);
}
