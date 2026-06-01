import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

export const ECR_DIGEST = `sha256:${"d".repeat(64)}`;
export const ECR_IMAGE = `123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane@${ECR_DIGEST}`;
export const ECR_BUILD_IDENTITY = `nix-source-${"e".repeat(64)}`;

export async function ecrHook(
  phase: "preview" | "apply" | "evidence" | "smoke" | "rollback" | "reviewed-import",
) {
  return runCloudProviderCapabilityHook({
    capabilityId: "aws-ecr-control-plane-registry",
    phase,
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: privateLinkAwsTopology(),
    registryProfile: registryProfile(),
    imagePublication: imagePublication(),
  });
}

export function registryProfile() {
  return ecrRegistryProfileForImage(ECR_IMAGE, ECR_DIGEST);
}

export function imagePublication() {
  return {
    image: ECR_IMAGE,
    sourceRevision: "source-reviewed",
    imageBuildIdentity: ECR_BUILD_IDENTITY,
    digest: ECR_DIGEST,
    inspectedDigest: ECR_DIGEST,
    tag: `${ECR_IMAGE.split("@")[0]}:source-reviewed`,
    evidenceSource: "generated-command" as const,
    registryProfile: registryProfile(),
  };
}

export async function withAwsCredentialFile<T>(run: () => Promise<T>): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "aws-creds-"));
  const file = path.join(tmp, "credentials");
  const previous = process.env.AWS_SHARED_CREDENTIALS_FILE;
  await fsp.writeFile(file, "[default]\naws_access_key_id=x\naws_secret_access_key=y\n", "utf8");
  process.env.AWS_SHARED_CREDENTIALS_FILE = file;
  try {
    return await run();
  } finally {
    restoreEnv("AWS_SHARED_CREDENTIALS_FILE", previous);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export async function withoutAwsCredentials(run: () => Promise<void>) {
  const previousShared = process.env.AWS_SHARED_CREDENTIALS_FILE;
  const previousProfile = process.env.AWS_PROFILE;
  const previousAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const previousAssumeRole = process.env.VBR_AWS_ECR_ASSUME_ROLE_ARN;
  const previousInstanceProfile = process.env.VBR_AWS_ECR_REVIEWED_INSTANCE_PROFILE_ARN;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.VBR_AWS_ECR_ASSUME_ROLE_ARN;
  delete process.env.VBR_AWS_ECR_REVIEWED_INSTANCE_PROFILE_ARN;
  try {
    await run();
  } finally {
    restoreEnv("AWS_SHARED_CREDENTIALS_FILE", previousShared);
    restoreEnv("AWS_PROFILE", previousProfile);
    restoreEnv("AWS_ACCESS_KEY_ID", previousAccessKey);
    restoreEnv("VBR_AWS_ECR_ASSUME_ROLE_ARN", previousAssumeRole);
    restoreEnv("VBR_AWS_ECR_REVIEWED_INSTANCE_PROFILE_ARN", previousInstanceProfile);
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
