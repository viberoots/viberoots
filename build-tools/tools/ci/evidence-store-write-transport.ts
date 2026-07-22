import fs from "node:fs";
import path from "node:path";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { redactPublisherOutput } from "./publisher-credentials";

export function evidenceStoreWriteEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  awsSharedCredentialsFile: string,
  expectedStoreUri: string,
): NodeJS.ProcessEnv {
  assertEvidenceStoreAwsCredentialsFile(awsSharedCredentialsFile, expectedStoreUri);
  const scrubbed = Object.fromEntries(
    Object.entries(baseEnv).filter(([name]) => !name.startsWith("AWS_")),
  );
  return {
    ...scrubbed,
    AWS_SHARED_CREDENTIALS_FILE: awsSharedCredentialsFile,
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

export async function copyToEvidenceStore(opts: {
  nix: string;
  baseEnv: NodeJS.ProcessEnv;
  awsSharedCredentialsFile: string;
  storeUri: string;
  storePaths: string[];
  cwd: string;
}): Promise<void> {
  if (
    !opts.storePaths.length ||
    opts.storePaths.some((value) => !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(value))
  ) {
    throw new Error("evidence-store write requires exact Nix store roots");
  }
  const env = evidenceStoreWriteEnvironment(
    opts.baseEnv,
    opts.awsSharedCredentialsFile,
    opts.storeUri,
  );
  const result = await runBoundedArtifactCommand({
    command: opts.nix,
    args: [...artifactNixPolicyArgs(), "copy", "--to", opts.storeUri, ...opts.storePaths],
    cwd: opts.cwd,
    env,
  });
  const redacted = {
    ...result,
    stdout: redactPublisherOutput(result.stdout, {
      AWS_SHARED_CREDENTIALS_FILE: String(env.AWS_SHARED_CREDENTIALS_FILE || ""),
    }),
    stderr: redactPublisherOutput(result.stderr, {
      AWS_SHARED_CREDENTIALS_FILE: String(env.AWS_SHARED_CREDENTIALS_FILE || ""),
    }),
  };
  assertArtifactCommandSucceeded("protected evidence-store write", redacted);
}

export async function copyArtifactPathsToEvidenceStore(opts: {
  workspaceRoot: string;
  artifactToolsRoot: string;
  awsSharedCredentialsFile: string;
  storeUri: string;
  storePaths: string[];
}): Promise<void> {
  const env = buildCanonicalArtifactEnvironment(opts.workspaceRoot, {
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  await copyToEvidenceStore({
    ...opts,
    nix: ensureNixStoreToolPathSync("nix", env),
    baseEnv: env,
    cwd: opts.workspaceRoot,
  });
}

export function assertEvidenceStoreAwsCredentialsFile(
  file: string,
  expectedStoreUri: string,
): string {
  const parsed = new URL(expectedStoreUri);
  if (
    parsed.protocol !== "s3:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("evidence-store writes require one credential-free S3 store authority");
  }
  readOwnerMode0600(file, "evidence-store AWS credentials");
  return file;
}

function readOwnerMode0600(file: string, name: string): void {
  if (!path.isAbsolute(file) || file.startsWith("/nix/store/")) {
    throw new Error(`${name} requires an external absolute path`);
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${name} must be a regular nofollow mode-0600 file`);
  }
  try {
    const stat = fs.fstatSync(descriptor);
    const uid = process.getuid?.();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      (uid !== undefined && stat.uid !== uid)
    ) {
      throw new Error(`${name} must be an owner-controlled mode-0600 file`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
