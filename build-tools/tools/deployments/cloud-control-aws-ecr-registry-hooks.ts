import * as fs from "node:fs";
import { awsFoundationDigest } from "./cloud-control-aws-foundation-credentials";
import type {
  HookAdapter,
  HookAdapterPhase,
  HookAdapterPhaseOptions,
} from "./cloud-control-provider-capability-hooks";
import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import {
  validateControlPlaneRegistryProfile,
  type ControlPlaneRegistryProfile,
} from "./control-plane-registry-profile";

const REQUIRED_PHASES = [
  "preview",
  "apply-intent",
  "evidence",
  "smoke",
  "rollback-plan",
  "reviewed-import",
] as const;

export function awsEcrRegistryHookAdapter(): HookAdapter {
  const phase =
    (name: string): HookAdapterPhase =>
    async (opts) => {
      const payload = ecrPayload(opts, name);
      return {
        summary: `aws-ecr-control-plane-registry ${name}`,
        rawOutput: [
          `aws-ecr-control-plane-registry ${name}`,
          `repository=${payload.repository.repositoryUri}`,
          `policyDigest=${payload.repository.repositoryPolicyDigest}`,
          `scanning=${payload.scanning.status}`,
          `publicationDigest=${payload.publish.digest}`,
        ].join(" "),
        payload,
      };
    };
  return {
    name: "aws-ecr-control-plane-registry",
    automated: true,
    preview: phase("preview"),
    apply: phase("apply-intent"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback-plan"),
    reviewedImport: phase("reviewed-import"),
  };
}

function ecrPayload(opts: HookAdapterPhaseOptions, phase: string) {
  const registryProfile = requireRegistryProfile(opts.registryProfile);
  const publication = requireImagePublication(opts.imagePublication);
  const errors = validateControlPlaneRegistryProfile(registryProfile, {
    expectedImageRef: publication.image,
    expectedDigest: publication.digest,
    expectedHostProfile: "aws-ec2",
    expectedAccountId: opts.awsTopologyEvidence?.accountId,
    expectedRegion: opts.awsTopologyEvidence?.region,
  });
  if (errors.length > 0) {
    throw new Error(`aws-ecr-control-plane-registry evidence rejected: ${errors.join("; ")}`);
  }
  const credentialSource = reviewedAwsCredentialSource();
  return {
    schemaVersion: "aws-ecr-control-plane-registry-hook-payload@1",
    phase,
    requiredPhases: REQUIRED_PHASES,
    credentialSource,
    repository: repositoryPayload(registryProfile),
    lifecycle: registryProfile.lifecyclePolicy,
    scanning: registryProfile.scanning,
    pull: registryProfile.runtimePull,
    publish: publishPayload(registryProfile, publication),
    provisioningPlan: provisioningPlan(registryProfile),
    rollbackPlan: [
      "retain repository and immutable image digests",
      "restore previous repository and lifecycle policies from reviewed evidence",
      "do not delete ECR repository or pushed production image digests",
    ],
    reviewedImport: {
      acceptedModes: ["aws-ecr", "imported-reviewed-profile"],
      refusalCases: ["missing policy digest", "mutable tags", "missing pull proof"],
      evidenceProfile: registryProfile,
    },
  };
}

function requireRegistryProfile(value: unknown): ControlPlaneRegistryProfile {
  if (!value || typeof value !== "object") {
    throw new Error("aws-ecr-control-plane-registry requires --registry-profile");
  }
  return value as ControlPlaneRegistryProfile;
}

function requireImagePublication(
  value: ControlPlaneImagePublicationEvidence | undefined,
): ControlPlaneImagePublicationEvidence {
  if (!value) {
    throw new Error("aws-ecr-control-plane-registry requires --image-publication-evidence");
  }
  return value;
}

function repositoryPayload(profile: ControlPlaneRegistryProfile) {
  return {
    accountId: profile.identity.accountId,
    region: profile.identity.region,
    repositoryArn: profile.identity.repositoryArn,
    repositoryUri: profile.identity.repositoryUri,
    repositoryPolicyDigest: awsFoundationDigest(profile.immutability.evidence),
  };
}

function publishPayload(
  profile: ControlPlaneRegistryProfile,
  publication: ControlPlaneImagePublicationEvidence,
) {
  return {
    principal: profile.publish.principal,
    evidence: profile.publish.evidence,
    image: publication.image,
    digest: publication.digest,
    inspectedDigest: publication.inspectedDigest,
  };
}

function provisioningPlan(profile: ControlPlaneRegistryProfile) {
  return {
    operation:
      profile.mode === "aws-ecr" ? "aws-ecr-reviewed-provision-or-reconcile" : "reviewed-import",
    repository: profile.repository,
    commands: [
      "aws ecr describe-repositories",
      "aws ecr create-repository --image-tag-mutability IMMUTABLE",
      "aws ecr put-lifecycle-policy",
      "aws ecr set-repository-policy",
      "aws ecr describe-image-scan-findings",
    ],
  };
}

function reviewedAwsCredentialSource(): string {
  const sharedFile = process.env.AWS_SHARED_CREDENTIALS_FILE?.trim();
  const assumeRole = process.env.VBR_AWS_ECR_ASSUME_ROLE_ARN?.trim();
  const instanceProfile = process.env.VBR_AWS_ECR_REVIEWED_INSTANCE_PROFILE_ARN?.trim();
  const ambient = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE;
  if (assumeRole) return `reviewed-assume-role:${assumeRole}`;
  if (sharedFile) {
    if (!fs.existsSync(sharedFile)) {
      throw new Error("AWS ECR hook requires existing AWS_SHARED_CREDENTIALS_FILE");
    }
    return `file-backed:${awsFoundationDigest(sharedFile)}`;
  }
  if (instanceProfile) return `reviewed-instance-profile:${instanceProfile}`;
  if (ambient) {
    throw new Error("AWS ECR hook rejects ambient/default-chain AWS credentials");
  }
  throw new Error(
    "AWS ECR hook requires file-backed AWS credentials or reviewed instance-profile/assume-role",
  );
}
