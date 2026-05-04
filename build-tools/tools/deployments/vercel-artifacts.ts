#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { artifactIdentityForVercelNextOutput } from "../vercel/next-artifact";

export type AdmittedVercelPrebuiltArtifact = {
  identity: string;
  outputDir: string;
};

async function exists(dir: string): Promise<boolean> {
  try {
    await fsp.access(dir);
    return true;
  } catch {
    return false;
  }
}

export async function resolveVercelPrebuiltOutputDir(artifactDir: string): Promise<string> {
  const root = path.resolve(artifactDir);
  const nested = path.join(root, ".vercel", "output");
  const outputDir = (await exists(path.join(nested, "config.json"))) ? nested : root;
  await fsp.access(path.join(outputDir, "config.json"));
  return outputDir;
}

export async function admitVercelPrebuiltArtifact(
  artifactDir: string,
): Promise<AdmittedVercelPrebuiltArtifact> {
  const outputDir = await resolveVercelPrebuiltOutputDir(artifactDir);
  return {
    identity: await artifactIdentityForVercelNextOutput(outputDir),
    outputDir,
  };
}

export async function requireAdmittedVercelArtifactPath(
  artifact: AdmittedVercelPrebuiltArtifact,
): Promise<string> {
  const outputDir = await resolveVercelPrebuiltOutputDir(artifact.outputDir);
  const actualIdentity = await artifactIdentityForVercelNextOutput(outputDir);
  if (actualIdentity !== artifact.identity) {
    throw new Error(
      `admitted Vercel artifact identity mismatch: expected ${artifact.identity}, got ${actualIdentity}`,
    );
  }
  return outputDir;
}
