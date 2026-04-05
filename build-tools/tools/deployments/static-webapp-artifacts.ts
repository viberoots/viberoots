#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree.ts";
import { sanitizeName } from "../lib/sanitize.ts";

export const STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA = "static-webapp-artifact-provenance@1";

export type AdmittedStaticWebappArtifact = {
  kind: "static-webapp";
  identity: string;
  storedArtifactPath: string;
  provenancePath: string;
};

type StaticWebappArtifactProvenance = {
  schemaVersion: typeof STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA;
  artifactKind: AdmittedStaticWebappArtifact["kind"];
  artifactIdentity: string;
  storedArtifactPath: string;
  admittedAt: string;
};

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, abs)));
      continue;
    }
    if (entry.isFile()) files.push(path.relative(root, abs));
  }
  return files;
}

export async function artifactIdentityForStaticWebappDir(artifactDir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const rel of await walkFiles(artifactDir)) {
    const abs = path.join(artifactDir, rel);
    hash.update(`${rel}\n`);
    hash.update(await fsp.readFile(abs));
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
): Promise<void> {
  if (await pathExists(provenancePath)) return;
  await fsp.mkdir(path.dirname(provenancePath), { recursive: true });
  const provenance: StaticWebappArtifactProvenance = {
    schemaVersion: STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA,
    artifactKind: artifact.kind,
    artifactIdentity: artifact.identity,
    storedArtifactPath: artifact.storedArtifactPath,
    admittedAt: new Date().toISOString(),
  };
  await fsp.writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n", "utf8");
}

export async function admitStaticWebappArtifact(opts: {
  recordsRoot: string;
  artifactDir: string;
}): Promise<AdmittedStaticWebappArtifact> {
  const artifactDir = path.resolve(opts.artifactDir);
  const identity = await artifactIdentityForStaticWebappDir(artifactDir);
  const artifact: AdmittedStaticWebappArtifact = {
    kind: "static-webapp",
    identity,
    storedArtifactPath: artifactStoredPathFor(opts.recordsRoot, identity),
    provenancePath: artifactProvenancePathFor(opts.recordsRoot, identity),
  };
  await ensureStoredArtifact(artifactDir, artifact.storedArtifactPath);
  await ensureArtifactProvenance(artifact.provenancePath, artifact);
  return artifact;
}

export async function requireAdmittedStaticWebappArtifactPath(
  artifact: AdmittedStaticWebappArtifact,
): Promise<string> {
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
