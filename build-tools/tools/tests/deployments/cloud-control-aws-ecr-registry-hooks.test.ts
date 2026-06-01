#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import {
  ECR_DIGEST,
  ecrHook,
  imagePublication,
  registryProfile,
  withAwsCredentialFile,
  withoutAwsCredentials,
} from "./cloud-control-aws-ecr-registry.fixture";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

test("AWS ECR provider hook emits mandatory non-destructive payload phases", async () => {
  await withAwsCredentialFile(async () => {
    for (const phase of [
      "preview",
      "apply",
      "evidence",
      "smoke",
      "rollback",
      "reviewed-import",
    ] as const) {
      const hook = await ecrHook(phase);
      const payload = hook.providerPayload as any;
      assert.equal(hook.hook.adapter, "aws-ecr-control-plane-registry");
      assert.equal(payload.repository.accountId, "123456789012");
      assert.equal(payload.repository.region, "us-east-1");
      assert.match(payload.repository.repositoryPolicyDigest, /^sha256:/);
      assert.equal(payload.lifecycle.status, "configured");
      assert.equal(payload.scanning.status, "enabled");
      assert.equal(payload.pull.proof.digest, ECR_DIGEST);
      assert.equal(payload.publish.digest, ECR_DIGEST);
      assert.equal(payload.iac.ownership, "opentofu-managed");
      assert.equal(payload.iac.orchestration, "reviewed-opentofu-artifacts");
      assert.equal(payload.iac.outcomes.plan.schemaVersion, "aws-ecr-opentofu-plan@1");
      assert.ok(payload.requiredPhases.includes("apply-intent"));
      assert.ok(payload.requiredPhases.includes("rollback-plan"));
      assert.ok(payload.requiredPhases.includes("reviewed-import"));
      assert.doesNotMatch(JSON.stringify(payload), /aws ecr create-repository/);
      assert.doesNotMatch(JSON.stringify(payload), /put-lifecycle-policy|set-repository-policy/);
      assert.equal(payload.reviewedImport.evidenceProfile.repository, registryProfile().repository);
      assert.doesNotMatch(JSON.stringify(payload), /delete-repository|docker push|skopeo copy/i);
    }
  });
});

test("AWS ECR provider hook rejects missing reviewed credentials", async () => {
  await withoutAwsCredentials(async () => {
    await assert.rejects(() => ecrHook("evidence"), /requires file-backed AWS credentials/);
  });
});

test("AWS ECR provider hook accepts reviewed assume-role credentials", async () => {
  await withoutAwsCredentials(async () => {
    process.env.VBR_AWS_ECR_ASSUME_ROLE_ARN =
      "arn:aws:iam::123456789012:role/reviewed-ecr-provisioner";
    const hook = await ecrHook("evidence");
    assert.match(
      String((hook.providerPayload as any).credentialSource),
      /reviewed-assume-role:arn:aws:iam::123456789012:role\/reviewed-ecr-provisioner/,
    );
  });
});

test("AWS ECR provider hook rejects ambient AWS credential discovery", async () => {
  const previous = process.env.AWS_PROFILE;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
  process.env.AWS_PROFILE = "default";
  try {
    await assert.rejects(() => ecrHook("evidence"), /rejects ambient\/default-chain/);
  } finally {
    if (previous === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = previous;
  }
});

test("AWS ECR generated commands use deployment-control-plane and reviewed evidence inputs", () => {
  const commands = JSON.parse(
    renderCloudControlSetupBundle(ec2HostProfileInput()).files["commands.json"]!,
  );
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const ecr = managed.commands.find(
    (entry: any) => entry.id === "provider-capability-aws-ecr-control-plane-registry",
  );
  assert.match(ecr.command, /deployment-control-plane provider-capability/);
  assert.match(ecr.command, /--registry-profile "\$PROFILE_ROOT\/registry-profile\.json"/);
  assert.match(
    ecr.command,
    /--image-publication-evidence "\$PROFILE_ROOT\/image-publication\.json"/,
  );
  assert.match(ecr.command, /--ecr-opentofu-plan "\$PROFILE_ROOT\/ecr-opentofu-plan\.json"/);
  assert.match(ecr.command, /--ecr-opentofu-apply "\$PROFILE_ROOT\/ecr-opentofu-apply\.json"/);
  assert.match(
    ecr.command,
    /--ecr-readonly-evidence "\$PROFILE_ROOT\/ecr-readonly-evidence\.json"/,
  );
  assert.ok(ecr.inputs.includes("$PROFILE_ROOT/ecr-opentofu-plan.json"));
  assert.ok(ecr.inputs.includes("$PROFILE_ROOT/ecr-opentofu-apply.json"));
  assert.ok(ecr.inputs.includes("$PROFILE_ROOT/ecr-readonly-evidence.json"));
});

test("deployment-control-plane provider-capability emits ECR hook evidence", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ecr-provider-cli-"));
  await withAwsCredentialFile(async () => {
    const profile = path.join(tmp, "registry-profile.json");
    const publication = path.join(tmp, "image-publication.json");
    await fsp.writeFile(profile, JSON.stringify(registryProfile(), null, 2), "utf8");
    await fsp.writeFile(publication, JSON.stringify(imagePublication(), null, 2), "utf8");
    const output: string[] = [];
    const oldLog = console.log;
    try {
      console.log = (message?: unknown) => output.push(String(message));
      await withControlPlaneArgv(
        [
          "provider-capability",
          "--deployment-id",
          "pleomino-staging",
          "--provider-capability",
          "aws-ecr-control-plane-registry",
          "--provider-capability-phase",
          "reviewed-import",
          "--registry-profile",
          profile,
          "--image-publication-evidence",
          publication,
        ],
        runDeploymentControlPlaneCommand,
      );
      const emitted = JSON.parse(output.join("\n"));
      assert.equal(emitted.phase, "reviewed-import");
      assert.equal(emitted.providerPayload.publish.digest, ECR_DIGEST);
    } finally {
      console.log = oldLog;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

test("deployment-control-plane ECR provider-capability requires image publication evidence", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ecr-provider-cli-missing-"));
  await withAwsCredentialFile(async () => {
    const profile = path.join(tmp, "registry-profile.json");
    await fsp.writeFile(profile, JSON.stringify(registryProfile(), null, 2), "utf8");
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          [
            "provider-capability",
            "--deployment-id",
            "pleomino-staging",
            "--provider-capability",
            "aws-ecr-control-plane-registry",
            "--registry-profile",
            profile,
          ],
          runDeploymentControlPlaneCommand,
        ),
      /requires --image-publication-evidence/,
    );
  });
  await fsp.rm(tmp, { recursive: true, force: true });
});
