#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";
import { sanitizeName } from "../lib/sanitize.ts";

export const KUBERNETES_ARTIFACT_PROVENANCE_SCHEMA = "kubernetes-component-artifact@1";

export type AdmittedKubernetesComponentArtifact = {
  componentId: string;
  identity: string;
  sourceKind: "directory" | "image-digest";
  storedArtifactPath: string;
  provenancePath: string;
};

const NODE_SERVICE_IDENTITY_SCHEMA = "node-service-artifact-identity@1";
const NODE_SERVICE_RUNTIME_SCHEMA = "node-service-runtime@1";
const IMAGE_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function validateNodeServiceArtifactDir(artifactPath: string): Promise<string> {
  const runtimePath = path.join(artifactPath, "runtime-contract.json");
  const identityPath = path.join(artifactPath, "artifact-identity.json");
  const runtime = await readJsonFile(runtimePath).catch((error: any) => {
    if (error?.code === "ENOENT") {
      throw new Error("service artifact must include runtime-contract.json");
    }
    throw error;
  });
  if (runtime.schemaVersion !== NODE_SERVICE_RUNTIME_SCHEMA) {
    throw new Error("service artifact runtime-contract.json must use node-service-runtime@1");
  }
  const identity = await readJsonFile(identityPath).catch((error: any) => {
    if (error?.code === "ENOENT") {
      throw new Error("service artifact must include reviewed node-service artifact identity");
    }
    throw error;
  });
  if (
    identity.schemaVersion !== NODE_SERVICE_IDENTITY_SCHEMA ||
    identity.kind !== "node-service" ||
    typeof identity.identity !== "string" ||
    !identity.identity.startsWith("node-service:")
  ) {
    throw new Error("service artifact must include reviewed node-service artifact identity");
  }
  return identity.identity;
}

async function validateImageDigestFile(artifactPath: string): Promise<string> {
  const digest = (await fsp.readFile(artifactPath, "utf8")).trim();
  if (!IMAGE_DIGEST_RE.test(digest)) {
    throw new Error("service artifact file must contain an OCI image digest sha256:<64 hex>");
  }
  return `image-digest:${digest}`;
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
    const stat = await fsp.stat(artifactPath).catch((error: any) => {
      if (error?.code === "ENOENT") throw new Error(`missing service artifact: ${artifactPath}`);
      throw error;
    });
    const sourceKind = stat.isDirectory() ? "directory" : "image-digest";
    const identity = stat.isDirectory()
      ? await validateNodeServiceArtifactDir(artifactPath)
      : await validateImageDigestFile(artifactPath);
    const artifact: AdmittedKubernetesComponentArtifact = {
      componentId,
      identity,
      sourceKind,
      storedArtifactPath: storedPathFor(opts.recordsRoot, identity),
      provenancePath: provenancePathFor(opts.recordsRoot, identity),
    };
    await ensureStoredArtifact(artifactPath, artifact.storedArtifactPath);
    await ensureProvenance(artifact);
    artifacts.push(artifact);
  }
  return artifacts;
}
