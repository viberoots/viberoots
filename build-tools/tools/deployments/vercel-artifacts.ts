#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree";
import { sanitizeName } from "../lib/sanitize";
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
  opts: { recordsRoot?: string } = {},
): Promise<AdmittedVercelPrebuiltArtifact> {
  const outputDir = await resolveVercelPrebuiltOutputDir(artifactDir);
  const identity = await artifactIdentityForVercelNextOutput(outputDir);
  if (opts.recordsRoot) {
    const storedOutputDir = path.join(
      path.resolve(opts.recordsRoot),
      "artifacts",
      "blobs",
      sanitizeName(identity),
    );
    await ensureStoredOutput(outputDir, storedOutputDir);
    return { identity, outputDir: storedOutputDir };
  }
  return {
    identity,
    outputDir,
  };
}

async function ensureStoredOutput(sourceDir: string, storedOutputDir: string): Promise<void> {
  if (await exists(path.join(storedOutputDir, "config.json"))) return;
  await fsp.mkdir(path.dirname(storedOutputDir), { recursive: true });
  const stagePath = `${storedOutputDir}.stage-${process.pid}-${Date.now()}`;
  await copyTree(sourceDir, stagePath, { cloneMode: "try", force: true });
  try {
    await fsp.rename(stagePath, storedOutputDir);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    await fsp.rm(stagePath, { recursive: true, force: true });
  }
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
