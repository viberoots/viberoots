import type { ControlPlaneRegistryProfile } from "../../deployments/control-plane-registry-profile";

const DEFAULT_DIGEST = `sha256:${"d".repeat(64)}`;
const DEFAULT_REPOSITORY = "123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane";
const DEFAULT_PRINCIPAL = "arn:aws:iam::123456789012:role/control-plane-instance-profile";

export function ecrRegistryProfile(
  overrides: Partial<ControlPlaneRegistryProfile> = {},
): ControlPlaneRegistryProfile {
  return {
    schemaVersion: "control-plane-registry-profile@1",
    mode: "aws-ecr",
    repository: DEFAULT_REPOSITORY,
    checkedAt: new Date().toISOString(),
    identity: {
      accountId: "123456789012",
      region: "us-east-1",
      repositoryArn: "arn:aws:ecr:us-east-1:123456789012:repository/deployment-control-plane",
      repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane",
    },
    immutability: { status: "immutable-tags", evidence: "ecr-tag-mutability IMMUTABLE" },
    lifecyclePolicy: {
      status: "configured",
      evidence: "lifecycle-policy-text-digest",
      ruleCount: 2,
    },
    scanning: { status: "enabled", evidence: "scan-on-push enabled" },
    runtimePull: {
      principal: DEFAULT_PRINCIPAL,
      credentialSource: "ec2-instance-profile",
      evidence: "repository policy grants BatchGetImage to instance profile",
      proof: runtimePullProof(`${DEFAULT_REPOSITORY}@${DEFAULT_DIGEST}`, DEFAULT_DIGEST),
    },
    publish: {
      principal: "arn:aws:iam::123456789012:role/control-plane-image-publisher",
      evidence: "publisher can PutImage only during reviewed publication",
    },
    iac: ecrIacEvidence(DEFAULT_REPOSITORY, DEFAULT_DIGEST),
    ...overrides,
  };
}

export function ecrRegistryProfileForImage(
  image: string,
  digest: string,
  repository = image.split("@")[0] || DEFAULT_REPOSITORY,
): ControlPlaneRegistryProfile {
  return {
    ...ecrRegistryProfile(),
    repository,
    identity: {
      accountId: "123456789012",
      region: "us-east-1",
      repositoryArn: "arn:aws:ecr:us-east-1:123456789012:repository/deployment-control-plane",
      repositoryUri: repository,
    },
    runtimePull: {
      ...ecrRegistryProfile().runtimePull,
      proof: runtimePullProof(image, digest),
    },
    iac: ecrIacEvidence(repository, digest),
  };
}

export function runtimePullProof(image: string, digest: string, principal = DEFAULT_PRINCIPAL) {
  return {
    hostProfile: "aws-ec2",
    image,
    digest,
    checkedAt: new Date().toISOString(),
    principal,
    evidence: "podman pull by digest succeeded from selected EC2 host profile",
  };
}

export function ecrIacEvidence(repositoryUri = DEFAULT_REPOSITORY, digest = DEFAULT_DIGEST) {
  const repository = {
    accountId: "123456789012",
    region: "us-east-1",
    repositoryArn: "arn:aws:ecr:us-east-1:123456789012:repository/deployment-control-plane",
    repositoryUri,
  };
  const posture = {
    tagMutability: "IMMUTABLE",
    lifecyclePolicyDigest: "sha256:lifecycle",
    lifecycleRuleCount: 2,
    scanOnPush: true,
    repositoryPolicyDigest: "sha256:policy",
    kms: { mode: "aws-managed" },
  };
  return {
    plan: {
      schemaVersion: "aws-ecr-opentofu-plan@1",
      source: "reviewed-opentofu-plan",
      checkedAt: new Date().toISOString(),
      bundleRoot: "$PROFILE_ROOT",
      workingDirectory:
        "$PROFILE_ROOT/build-tools/deployments/aws-control-plane-foundation/opentofu",
      evidencePath: "$PROFILE_ROOT/ecr-opentofu-plan.json",
      outputPath: "$PROFILE_ROOT/ecr-opentofu-plan.out.json",
      planDigest: "sha256:plan",
      repository,
      posture,
      importAdoption: { mode: "managed" },
    },
    apply: {
      schemaVersion: "aws-ecr-opentofu-apply@1",
      source: "reviewed-opentofu-apply",
      checkedAt: new Date().toISOString(),
      bundleRoot: "$PROFILE_ROOT",
      workingDirectory:
        "$PROFILE_ROOT/build-tools/deployments/aws-control-plane-foundation/opentofu",
      evidencePath: "$PROFILE_ROOT/ecr-opentofu-apply.json",
      outputPath: "$PROFILE_ROOT/ecr-opentofu-apply.out.json",
      planDigest: "sha256:plan",
      applyDigest: "sha256:apply",
      repository,
      posture,
    },
    readOnly: {
      schemaVersion: "aws-ecr-readonly-evidence@1",
      source: "aws-ecr-readonly-inspection",
      checkedAt: new Date().toISOString(),
      bundleRoot: "$PROFILE_ROOT",
      workingDirectory:
        "$PROFILE_ROOT/build-tools/deployments/aws-control-plane-foundation/opentofu",
      evidencePath: "$PROFILE_ROOT/ecr-readonly-evidence.json",
      outputPath: "$PROFILE_ROOT/ecr-readonly-evidence.out.json",
      evidenceDigest: digest,
      repository,
      posture,
    },
  };
}
