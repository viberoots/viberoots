import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

export function awsFoundationCredentialEnv(): NodeJS.ProcessEnv {
  const credentialFile = process.env.AWS_SHARED_CREDENTIALS_FILE?.trim();
  if (!credentialFile || !fs.existsSync(credentialFile)) {
    throw new Error("AWS foundation live execution requires AWS_SHARED_CREDENTIALS_FILE");
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("AWS_")),
  ) as NodeJS.ProcessEnv;
  return {
    ...env,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_PROFILE: process.env.VBR_AWS_FOUNDATION_SOURCE_PROFILE?.trim() || "default",
    AWS_SHARED_CREDENTIALS_FILE: credentialFile,
  };
}

export function awsFoundationCredentialIdentity(): string {
  return `file-backed:${awsFoundationDigest(process.env.AWS_SHARED_CREDENTIALS_FILE || "")}`;
}

export function assumeAwsFoundationRole(
  roleArn: string,
  env: NodeJS.ProcessEnv,
): { env: NodeJS.ProcessEnv; identity: string } {
  const raw = execFileSync(
    "aws",
    ["sts", "assume-role", "--role-arn", roleArn, "--role-session-name", "vbr-aws-foundation"],
    { encoding: "utf8", env },
  );
  const credentials = JSON.parse(raw).Credentials as Record<string, string>;
  return {
    identity: `assumed-role:${roleArn}`,
    env: {
      ...env,
      AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
      AWS_SESSION_TOKEN: credentials.SessionToken,
    },
  };
}

export function awsFoundationLiveEnv(): { env: NodeJS.ProcessEnv; identity: string } {
  const sourceEnv = awsFoundationCredentialEnv();
  const roleArn = process.env.VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN?.trim();
  return process.env.VBR_AWS_FOUNDATION_LIVE === "1" && roleArn
    ? assumeAwsFoundationRole(roleArn, sourceEnv)
    : { env: sourceEnv, identity: awsFoundationCredentialIdentity() };
}

export function awsFoundationDigest(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(stable(value));
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}
