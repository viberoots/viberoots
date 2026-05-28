#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";

const profilePattern = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const labelPattern = /^[A-Za-z0-9_.-]+\/\/[A-Za-z0-9_./-]*:[A-Za-z0-9_.-]+$/;
const generatedFileMode = 0o600;

export type RemoteTestActivationInput = {
  artifactDir: string;
  passName: string;
  targetProfile: string;
  executionPlatforms?: string;
};

export type RemoteTestActivationResult = {
  configPath: string;
  configText: string;
  summary: string;
};

export async function writeRemoteTestActivationConfig(
  input: RemoteTestActivationInput,
): Promise<RemoteTestActivationResult> {
  const configText = renderRemoteTestActivationConfigText(input);
  const configPath = path.join(
    validateArtifactDir(input.artifactDir),
    `${input.passName}.buckconfig`,
  );
  await fs.mkdir(input.artifactDir, { recursive: true });
  await fs.writeFile(configPath, configText, { mode: generatedFileMode });
  return {
    configPath,
    configText,
    summary: `pass=${input.passName} profile=${input.targetProfile}`,
  };
}

export function renderRemoteTestActivationConfigText(input: RemoteTestActivationInput): string {
  validatePassName(input.passName);
  validateProfile(input.targetProfile);
  const executionPlatforms =
    input.executionPlatforms || "repo_toolchains//:remote_execution_platforms";
  validateToolchainLabel(executionPlatforms);
  return [
    "[build]",
    `execution_platforms = ${executionPlatforms}`,
    "",
    "[test]",
    `viberoots_remote_profile = ${input.targetProfile}`,
    "",
  ].join("\n");
}

function validateArtifactDir(dir: string): string {
  const resolved = path.resolve(dir);
  if (!dir || dir === "." || dir === path.parse(resolved).root) {
    throw new Error("remote activation directory must be an explicit artifact directory");
  }
  return resolved;
}

function validatePassName(passName: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(passName)) throw new Error("invalid activation passName");
}

function validateProfile(profile: string): void {
  if (!profilePattern.test(profile)) throw new Error("invalid activation targetProfile");
}

function validateToolchainLabel(label: string): void {
  if (!labelPattern.test(label)) throw new Error("invalid activation executionPlatforms label");
}
