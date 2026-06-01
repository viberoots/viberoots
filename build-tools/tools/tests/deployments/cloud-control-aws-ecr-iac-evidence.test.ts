#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import {
  ecrHook,
  registryProfile,
  withAwsCredentialFile,
} from "./cloud-control-aws-ecr-registry.fixture";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";

test("ECR readiness and cutover require typed OpenTofu plan apply and read-only evidence", async () => {
  await withAwsCredentialFile(async () => {
    const hook = await ecrHook("evidence");
    assert.deepEqual(
      validateProviderCapabilityEvidence([hook.declaration], { [hook.capabilityId]: hook }),
      [],
    );
    const evidenceOnly = {
      ...hook,
      providerPayload: {
        ...(hook.providerPayload || {}),
        registryProfile: { ...registryProfile(), iac: {} },
      },
    };
    assert.match(
      validateProviderCapabilityEvidence([hook.declaration], {
        [hook.capabilityId]: evidenceOnly,
      }).join("\n"),
      /ECR IaC plan schema is unsupported.*ECR IaC apply schema is unsupported/s,
    );
    const commandTemplate = {
      ...hook,
      providerPayload: {
        ...(hook.providerPayload || {}),
        provisioningPlan: {
          commands: ["aws ecr create-repository --image-tag-mutability IMMUTABLE"],
        },
      },
    };
    assert.match(
      validateProviderCapabilityEvidence([hook.declaration], {
        [hook.capabilityId]: commandTemplate,
      }).join("\n"),
      /must not contain direct ECR mutation commands/,
    );
    const smoke = await ecrHook("smoke");
    assert.deepEqual(
      validateCutoverProviderCapabilities(
        {
          awsTopology: privateLinkAwsTopology(),
          providerCapabilities: { [smoke.capabilityId]: smoke },
        } as any,
        [smoke.capabilityId],
      ),
      [],
    );
  });
});

test("ECR evidence fails closed when apply or read-only posture drifts from reviewed IaC", async () => {
  await withAwsCredentialFile(async () => {
    const hook = await ecrHook("evidence");
    const profile = structuredClone((hook.providerPayload as any).registryProfile);
    profile.iac.plan.posture = {
      ...profile.iac.plan.posture,
      kms: { ...profile.iac.plan.posture.kms },
    };
    profile.iac.apply.posture = {
      ...profile.iac.apply.posture,
      kms: { ...profile.iac.apply.posture.kms },
    };
    profile.iac.readOnly.posture = {
      ...profile.iac.readOnly.posture,
      kms: { ...profile.iac.readOnly.posture.kms },
    };
    profile.iac.apply.posture.repositoryPolicyDigest = "sha256:apply-policy-drift";
    profile.iac.apply.posture.kms = { mode: "customer-managed", keyArn: "arn:aws:kms:drift" };
    profile.iac.readOnly.posture.tagMutability = "MUTABLE";
    profile.iac.readOnly.posture.scanOnPush = false;
    profile.iac.readOnly.posture.lifecyclePolicyDigest = "sha256:readonly-lifecycle-drift";
    profile.iac.readOnly.posture.repositoryPolicyDigest = "sha256:readonly-policy-drift";
    profile.iac.readOnly.posture.kms = {
      mode: "customer-managed",
      keyArn: "arn:aws:kms:readonly-drift",
    };
    const drifted = {
      ...hook,
      providerPayload: { ...(hook.providerPayload || {}), registryProfile: profile },
    };
    const errors = validateProviderCapabilityEvidence([hook.declaration], {
      [hook.capabilityId]: drifted,
    }).join("\n");
    assert.match(errors, /apply repository policy does not match reviewed plan/);
    assert.match(errors, /apply KMS encryption posture does not match reviewed plan/);
    assert.match(errors, /read-only evidence tag mutability does not match reviewed plan/);
    assert.match(errors, /read-only evidence scan-on-push does not match reviewed plan/);
    assert.match(errors, /read-only evidence lifecycle policy does not match reviewed plan/);
    assert.match(errors, /read-only evidence repository policy does not match reviewed apply/);
    assert.match(errors, /read-only evidence KMS encryption posture does not match reviewed apply/);
  });
});

test("ECR evidence rejects generated output paths outside the setup bundle root", async () => {
  await withAwsCredentialFile(async () => {
    const hook = await ecrHook("evidence");
    const profile = structuredClone((hook.providerPayload as any).registryProfile);
    profile.iac.plan.workingDirectory = "/tmp/opentofu";
    profile.iac.apply.evidencePath = "ecr-opentofu-apply.json";
    profile.iac.readOnly.outputPath = "$PROFILE_ROOT/../ecr-readonly-evidence.out.json";
    const drifted = {
      ...hook,
      providerPayload: { ...(hook.providerPayload || {}), registryProfile: profile },
    };
    assert.match(
      validateProviderCapabilityEvidence([hook.declaration], {
        [hook.capabilityId]: drifted,
      }).join("\n"),
      /plan working directory must resolve from setup bundle root.*apply evidence path must resolve from setup bundle root.*read-only evidence output path must resolve from setup bundle root/s,
    );
  });
});

test("generated ECR bundle carries OpenTofu evidence files and bundle-root command paths", () => {
  const bundle = renderCloudControlSetupBundle(ec2HostProfileInput());
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const ecrPlan = JSON.parse(bundle.files["ecr-opentofu-plan.json"]!);
  const tfvars = JSON.parse(bundle.files["ecr-opentofu.tfvars.json"]!);
  assert.ok(bundle.files["ecr-opentofu-plan.json"]);
  assert.ok(bundle.files["ecr-opentofu-apply.json"]);
  assert.ok(bundle.files["ecr-readonly-evidence.json"]);
  assert.ok(bundle.files["opentofu/aws-control-plane-foundation/ecr.tf"]);
  assert.match(bundle.files["ecr-backend.hcl"]!, /dynamodb_table/);
  assert.match(bundle.files["ecr-evidence-template.json"]!, /Do not submit this template/);
  assert.equal(tfvars.ecr_enabled, true);
  assert.equal(tfvars.ecr_repository_name, "deployment-control-plane");
  assert.equal(ecrPlan.workingDirectory, "$PROFILE_ROOT/opentofu/aws-control-plane-foundation");
  assert.equal(ecrPlan.evidencePath, "$PROFILE_ROOT/ecr-opentofu-plan.json");
  assert.equal(ecrPlan.outputPath, "$PROFILE_ROOT/ecr-opentofu-plan.out.json");
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const plan = managed.commands.find((entry: any) => entry.id === "ecr-opentofu-plan");
  assert.match(plan.command, /tofu .* plan /);
  assert.match(plan.command, /-backend-config="\$PROFILE_ROOT\/ecr-backend\.hcl"/);
  assert.doesNotMatch(plan.command, /-backend=false/);
  assert.match(plan.command, /\$PROFILE_ROOT\/opentofu\/aws-control-plane-foundation/);
  assert.match(plan.command, /ecr-opentofu\.tfvars\.json/);
  assert.ok(plan.inputs.includes("$PROFILE_ROOT/ecr-backend.hcl"));
  assert.ok(plan.inputs.includes("$PROFILE_ROOT/opentofu/aws-control-plane-foundation/ecr.tf"));
  const apply = managed.commands.find((entry: any) => entry.id === "ecr-opentofu-apply");
  assert.match(apply.command, /tofu .* apply /);
  assert.match(apply.command, /tofu .* init .*backend-config/);
  assert.doesNotMatch(apply.command, /-backend=false/);
  const readOnly = managed.commands.find((entry: any) => entry.id === "ecr-readonly-evidence");
  assert.match(readOnly.command, /aws ecr describe-repositories/);
  assert.match(readOnly.command, /aws ecr get-lifecycle-policy/);
  assert.match(readOnly.command, /aws ecr get-repository-policy/);
  const ecr = managed.commands.find(
    (entry: any) => entry.id === "provider-capability-aws-ecr-control-plane-registry",
  );
  assert.equal(ecr.cwd, "profile-root");
  assert.match(ecr.command, /PROFILE_ROOT="\$\{PROFILE_ROOT:-\$\(pwd\)\}"/);
  assert.match(ecr.command, /--provider-capability aws-ecr-control-plane-registry --preview/);
  assert.match(
    ecr.command,
    /--provider-capability aws-ecr-control-plane-registry --provider-capability-phase apply/,
  );
  assert.ok(managed.commands.indexOf(readOnly) < managed.commands.indexOf(ecr));
  for (const file of ["ecr-opentofu-plan", "ecr-opentofu-apply", "ecr-readonly-evidence"]) {
    assert.match(ecr.command, new RegExp(`\\$PROFILE_ROOT/${file}\\.json`));
    assert.ok(ecr.inputs.includes(`$PROFILE_ROOT/${file}.json`));
  }
});

test("AWS foundation OpenTofu declares ECR repository posture and import adoption surface", async () => {
  const root = path.join(
    process.cwd(),
    "build-tools/deployments/aws-control-plane-foundation/opentofu",
  );
  const combined = await Promise.all(
    ["ecr.tf", "variables-ecr.tf", "outputs.tf"].map((file) =>
      fsp.readFile(path.join(root, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  assert.match(combined, /resource "aws_ecr_repository" "control_plane"/);
  assert.match(combined, /image_tag_mutability = var\.ecr_image_tag_mutability/);
  assert.match(combined, /scan_on_push = var\.ecr_scan_on_push/);
  assert.match(combined, /ecr_kms_key_arn/);
  assert.match(combined, /aws_ecr_lifecycle_policy/);
  assert.match(combined, /aws_ecr_repository_policy/);
  assert.match(combined, /ecr_import_adoption_metadata/);
  assert.match(combined, /repositoryPolicyDigest/);
});
