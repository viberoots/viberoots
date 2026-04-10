#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";
import { sanitizeName } from "../lib/sanitize.ts";

export const KUBERNETES_ARTIFACT_PROVENANCE_SCHEMA = "kubernetes-component-artifact@1";

export type AdmittedKubernetesComponentArtifact = {
  componentId: string;
  identity: string;
  sourceKind: "file" | "directory";
  storedArtifactPath: string;
  provenancePath: string;
};

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, abs)));
    else if (entry.isFile()) files.push(path.relative(root, abs));
  }
  return files;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function artifactIdentityForPath(componentId: string, artifactPath: string): Promise<string> {
  const stat = await fsp.stat(artifactPath);
  const hash = crypto.createHash("sha256");
  hash.update(`${componentId}\n`);
  if (stat.isDirectory()) {
    for (const rel of await walkFiles(artifactPath)) {
      hash.update(`${rel}\n`);
      hash.update(await fsp.readFile(path.join(artifactPath, rel)));
      hash.update("\n");
    }
  } else {
    hash.update(path.basename(artifactPath));
    hash.update("\n");
    hash.update(await fsp.readFile(artifactPath));
    hash.update("\n");
  }
  return `service-artifact:${hash.digest("hex")}`;
}

function storedPathFor(recordsRoot: string, identity: string): string {
  return path.join(path.resolve(recordsRoot), "artifacts", "blobs", sanitizeName(identity));
}

function provenancePathFor(recordsRoot: string, identity: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "artifacts",
    "provenance",
    `${sanitizeName(identity)}.json`,
  );
}

async function ensureStoredArtifact(sourcePath: string, targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) return;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const stat = await fsp.stat(sourcePath);
  if (stat.isDirectory()) {
    const stagePath = `${targetPath}.stage-${process.pid}-${Date.now()}`;
    await copyTree(sourcePath, stagePath, { cloneMode: "try", force: true });
    try {
      await fsp.rename(stagePath, targetPath);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await fsp.rm(stagePath, { recursive: true, force: true });
    }
    return;
  }
  await fsp.copyFile(sourcePath, targetPath).catch(async (error: any) => {
    if (error?.code !== "EEXIST") throw error;
  });
}

async function ensureProvenance(artifact: AdmittedKubernetesComponentArtifact): Promise<void> {
  if (await pathExists(artifact.provenancePath)) return;
  await fsp.mkdir(path.dirname(artifact.provenancePath), { recursive: true });
  await fsp.writeFile(
    artifact.provenancePath,
    JSON.stringify(
      {
        schemaVersion: KUBERNETES_ARTIFACT_PROVENANCE_SCHEMA,
        componentId: artifact.componentId,
        artifactIdentity: artifact.identity,
        sourceKind: artifact.sourceKind,
        storedArtifactPath: artifact.storedArtifactPath,
        admittedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function admitKubernetesComponentArtifacts(opts: {
  recordsRoot: string;
  artifactPathsByComponentId: Record<string, string>;
}): Promise<AdmittedKubernetesComponentArtifact[]> {
  const artifacts: AdmittedKubernetesComponentArtifact[] = [];
  for (const componentId of Object.keys(opts.artifactPathsByComponentId).sort()) {
    const artifactPath = path.resolve(opts.artifactPathsByComponentId[componentId] || "");
    const stat = await fsp.stat(artifactPath);
    const identity = await artifactIdentityForPath(componentId, artifactPath);
    const artifact: AdmittedKubernetesComponentArtifact = {
      componentId,
      identity,
      sourceKind: stat.isDirectory() ? "directory" : "file",
      storedArtifactPath: storedPathFor(opts.recordsRoot, identity),
      provenancePath: provenancePathFor(opts.recordsRoot, identity),
    };
    await ensureStoredArtifact(artifactPath, artifact.storedArtifactPath);
    await ensureProvenance(artifact);
    artifacts.push(artifact);
  }
  return artifacts;
}
