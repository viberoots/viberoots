#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree";
import { sanitizeName } from "../lib/sanitize";
import {
  artifactObjectReferenceUrl,
  putVerifiedArtifactObject,
} from "./control-plane-artifact-store";
import type {
  ControlPlaneArtifactObject,
  ControlPlaneArtifactStore,
} from "./control-plane-artifact-store-types";
import { createStaticWebappArtifactBundleBytes } from "./static-webapp-artifact-bundle";

export const KUBERNETES_ARTIFACT_PROVENANCE_SCHEMA = "kubernetes-component-artifact@1";

export type AdmittedKubernetesComponentArtifact = {
  componentId: string;
  identity: string;
  sourceKind: "directory" | "image-digest" | "image-ref";
  storedArtifactPath: string;
  provenancePath: string;
  object?: ControlPlaneArtifactObject;
};

const NODE_SERVICE_IDENTITY_SCHEMA = "node-service-artifact-identity@1";
const NODE_SERVICE_RUNTIME_SCHEMA = "node-service-runtime@1";
const IMAGE_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REF_WITH_DIGEST_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*@sha256:[a-f0-9]{64}$/;
const MUTABLE_TAGS = new Set(["latest", "dev", "staging", "prod"]);

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

function tagFromImageReference(value: string): string {
  const slash = value.lastIndexOf("/");
  const colon = value.lastIndexOf(":");
  return colon > slash ? value.slice(colon + 1).trim() : "";
}

async function validateImageDigestFile(artifactPath: string): Promise<{
  identity: string;
  sourceKind: "image-digest" | "image-ref";
}> {
  const value = (await fsp.readFile(artifactPath, "utf8")).trim();
  if (IMAGE_DIGEST_RE.test(value)) {
    return { identity: `image-digest:${value}`, sourceKind: "image-digest" };
  }
  if (IMAGE_REF_WITH_DIGEST_RE.test(value)) {
    return { identity: `image-ref:${value}`, sourceKind: "image-ref" };
  }
  const tag = tagFromImageReference(value);
  if (MUTABLE_TAGS.has(tag)) {
    throw new Error(
      `service artifact image reference uses mutable tag "${tag}"; use an admitted artifact reference or image@sha256 digest`,
    );
  }
  if (tag) {
    throw new Error(
      "service artifact image reference must be pinned with @sha256 digest, not a mutable tag",
    );
  }
  throw new Error(
    "service artifact file must contain an OCI image digest (sha256:<64 hex> or image@sha256:<64 hex>)",
  );
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
        ...(artifact.object ? { object: artifact.object } : {}),
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
  objectStore?: ControlPlaneArtifactStore;
  deploymentId?: string;
  submissionId?: string;
}): Promise<AdmittedKubernetesComponentArtifact[]> {
  const artifacts: AdmittedKubernetesComponentArtifact[] = [];
  for (const componentId of Object.keys(opts.artifactPathsByComponentId).sort()) {
    const artifactPath = path.resolve(opts.artifactPathsByComponentId[componentId] || "");
    const stat = await fsp.stat(artifactPath).catch((error: any) => {
      if (error?.code === "ENOENT") throw new Error(`missing service artifact: ${artifactPath}`);
      throw error;
    });
    const validated = stat.isDirectory()
      ? {
          identity: await validateNodeServiceArtifactDir(artifactPath),
          sourceKind: "directory" as const,
        }
      : await validateImageDigestFile(artifactPath);
    const object =
      opts.objectStore && stat.isDirectory()
        ? await putVerifiedArtifactObject({
            store: opts.objectStore,
            body: await createStaticWebappArtifactBundleBytes(artifactPath),
            payloadKind: "artifact",
            provenance: {
              deploymentId: opts.deploymentId,
              submissionId: opts.submissionId,
              artifactIdentity: validated.identity,
            },
          })
        : undefined;
    const artifact: AdmittedKubernetesComponentArtifact = {
      componentId,
      identity: validated.identity,
      sourceKind: validated.sourceKind,
      storedArtifactPath: object
        ? artifactObjectReferenceUrl(object)
        : storedPathFor(opts.recordsRoot, validated.identity),
      provenancePath: provenancePathFor(opts.recordsRoot, validated.identity),
      ...(object ? { object } : {}),
    };
    if (!object) await ensureStoredArtifact(artifactPath, artifact.storedArtifactPath);
    await ensureProvenance(artifact);
    artifacts.push(artifact);
  }
  return artifacts;
}
