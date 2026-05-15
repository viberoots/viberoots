#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree";
import { sanitizeName } from "../lib/sanitize";
import {
  createStaticWebappArtifactBundleBytes,
  inspectStaticWebappArtifactDir,
} from "./static-webapp-artifact-bundle";
import {
  artifactObjectReferenceUrl,
  putVerifiedArtifactObject,
} from "./control-plane-artifact-store";
import type {
  ControlPlaneArtifactObject,
  ControlPlaneArtifactStore,
} from "./control-plane-artifact-store-types";

export const STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA = "static-webapp-artifact-provenance@1";

export type StaticWebappArtifactProducerKind =
  | "server_build"
  | "client_upload"
  | "ci_attested"
  | "existing_admitted_artifact"
  | "local_direct";

export type StaticWebappArtifactProducer = {
  producerKind: StaticWebappArtifactProducerKind;
  sourceRevision?: string;
  deploymentLabel?: string;
  buildTarget?: string;
  storageReference?: string;
  archiveDigest?: string;
  archiveFormat?: string;
  ciRunId?: string;
};

export type AdmittedStaticWebappArtifact = {
  kind: "static-webapp";
  identity: string;
  storedArtifactPath: string;
  provenancePath: string;
  producerKind?: StaticWebappArtifactProducerKind;
  sourceRevision?: string;
  buildTarget?: string;
  storageReference?: string;
  object?: ControlPlaneArtifactObject;
};

type StaticWebappArtifactProvenance = {
  schemaVersion: typeof STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA;
  artifactKind: AdmittedStaticWebappArtifact["kind"];
  artifactIdentity: string;
  storedArtifactPath: string;
  object?: ControlPlaneArtifactObject;
  admittedAt: string;
  producer?: StaticWebappArtifactProducer;
};

export async function artifactIdentityForStaticWebappDir(artifactDir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const file of await inspectStaticWebappArtifactDir(artifactDir)) {
    hash.update(`${file.rel}\n`);
    hash.update(file.executable ? "executable\n" : "file\n");
    hash.update(await fsp.readFile(file.abs));
    hash.update("\n");
  }
  return `static-webapp:${hash.digest("hex")}`;
}

function artifactStoredPathFor(recordsRoot: string, identity: string): string {
  return path.join(path.resolve(recordsRoot), "artifacts", "blobs", sanitizeName(identity));
}

function artifactProvenancePathFor(recordsRoot: string, identity: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "artifacts",
    "provenance",
    `${sanitizeName(identity)}.json`,
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureStoredArtifact(sourcePath: string, storedArtifactPath: string): Promise<void> {
  if (await pathExists(storedArtifactPath)) return;
  await fsp.mkdir(path.dirname(storedArtifactPath), { recursive: true });
  const stagePath = `${storedArtifactPath}.stage-${process.pid}-${Date.now()}`;
  await copyTree(sourcePath, stagePath, { cloneMode: "try", force: true });
  try {
    await fsp.rename(stagePath, storedArtifactPath);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    await fsp.rm(stagePath, { recursive: true, force: true });
  }
}

async function ensureArtifactProvenance(
  provenancePath: string,
  artifact: AdmittedStaticWebappArtifact,
  producer?: StaticWebappArtifactProducer,
): Promise<void> {
  if (await pathExists(provenancePath)) return;
  await fsp.mkdir(path.dirname(provenancePath), { recursive: true });
  const provenance: StaticWebappArtifactProvenance = {
    schemaVersion: STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA,
    artifactKind: artifact.kind,
    artifactIdentity: artifact.identity,
    storedArtifactPath: artifact.storedArtifactPath,
    ...(artifact.object ? { object: artifact.object } : {}),
    admittedAt: new Date().toISOString(),
    ...(producer ? { producer } : {}),
  };
  await fsp.writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n", "utf8");
}

export async function admitStaticWebappArtifact(opts: {
  recordsRoot: string;
  artifactDir: string;
  producer?: StaticWebappArtifactProducer;
  objectStore?: ControlPlaneArtifactStore;
  deploymentId?: string;
  submissionId?: string;
}): Promise<AdmittedStaticWebappArtifact> {
  const artifactDir = path.resolve(opts.artifactDir);
  const identity = await artifactIdentityForStaticWebappDir(artifactDir);
  const object = opts.objectStore
    ? await putVerifiedArtifactObject({
        store: opts.objectStore,
        body: await createStaticWebappArtifactBundleBytes(artifactDir),
        payloadKind: "artifact",
        provenance: {
          deploymentId: opts.deploymentId,
          submissionId: opts.submissionId,
          artifactIdentity: identity,
        },
      })
    : undefined;
  const artifact: AdmittedStaticWebappArtifact = {
    kind: "static-webapp",
    identity,
    storedArtifactPath: object
      ? artifactObjectReferenceUrl(object)
      : artifactStoredPathFor(opts.recordsRoot, identity),
    provenancePath: artifactProvenancePathFor(opts.recordsRoot, identity),
    ...(object ? { object } : {}),
    ...(opts.producer?.producerKind ? { producerKind: opts.producer.producerKind } : {}),
    ...(opts.producer?.sourceRevision ? { sourceRevision: opts.producer.sourceRevision } : {}),
    ...(opts.producer?.buildTarget ? { buildTarget: opts.producer.buildTarget } : {}),
    ...(opts.producer?.storageReference
      ? { storageReference: opts.producer.storageReference }
      : {}),
  };
  if (!object) await ensureStoredArtifact(artifactDir, artifact.storedArtifactPath);
  await ensureArtifactProvenance(artifact.provenancePath, artifact, opts.producer);
  return artifact;
}

export async function readAdmittedStaticWebappArtifact(opts: {
  recordsRoot: string;
  artifactIdentity: string;
}): Promise<AdmittedStaticWebappArtifact> {
  const provenancePath = artifactProvenancePathFor(opts.recordsRoot, opts.artifactIdentity);
  const provenance = JSON.parse(
    await fsp.readFile(provenancePath, "utf8"),
  ) as StaticWebappArtifactProvenance;
  if (provenance.schemaVersion !== STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA) {
    throw new Error(`unsupported static-webapp artifact provenance: ${provenance.schemaVersion}`);
  }
  return {
    kind: "static-webapp",
    identity: provenance.artifactIdentity,
    storedArtifactPath: provenance.storedArtifactPath,
    provenancePath,
    ...(provenance.object ? { object: provenance.object } : {}),
    ...(provenance.producer?.producerKind
      ? { producerKind: provenance.producer.producerKind }
      : {}),
    ...(provenance.producer?.sourceRevision
      ? { sourceRevision: provenance.producer.sourceRevision }
      : {}),
    ...(provenance.producer?.buildTarget ? { buildTarget: provenance.producer.buildTarget } : {}),
    ...(provenance.producer?.storageReference
      ? { storageReference: provenance.producer.storageReference }
      : {}),
  };
}

export async function requireAdmittedStaticWebappArtifactPath(
  artifact: AdmittedStaticWebappArtifact,
): Promise<string> {
  if (artifact.object && artifact.storedArtifactPath.startsWith("artifact-object://")) {
    throw new Error(
      `artifact object must be materialized before provider execution: ${artifact.identity}`,
    );
  }
  const storedArtifactPath = path.resolve(artifact.storedArtifactPath);
  try {
    const stat = await fsp.stat(storedArtifactPath);
    if (!stat.isDirectory()) {
      throw new Error(`stored artifact is not a directory: ${storedArtifactPath}`);
    }
  } catch {
    throw new Error(
      `recorded exact artifact is unavailable: ${artifact.identity} (${storedArtifactPath})`,
    );
  }
  return storedArtifactPath;
}
