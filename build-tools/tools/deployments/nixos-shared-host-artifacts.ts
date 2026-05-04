#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree";
import { sanitizeName } from "../lib/sanitize";
import { inspectStaticWebappArtifactDir } from "./static-webapp-artifact-bundle";
import { assertFinalizedStagedArtifactPath } from "./nixos-shared-host-staged-artifact";

export const NIXOS_SHARED_HOST_ARTIFACT_PROVENANCE_SCHEMA =
  "nixos-shared-host-artifact-provenance@2";

export type NixosSharedHostAdmittedArtifact = {
  kind: "static-webapp" | "ssr-webapp";
  identity: string;
  storedArtifactPath: string;
  provenancePath: string;
};

type ArtifactKind = NixosSharedHostAdmittedArtifact["kind"];

export async function artifactIdentityForNixosSharedHostDir(
  artifactDir: string,
  kind: ArtifactKind,
): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const file of await inspectStaticWebappArtifactDir(path.resolve(artifactDir))) {
    hash.update(`${file.rel}\n`);
    hash.update(file.executable ? "executable\n" : "file\n");
    hash.update(await fsp.readFile(file.abs));
    hash.update("\n");
  }
  return `${kind}:${hash.digest("hex")}`;
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
  artifact: NixosSharedHostAdmittedArtifact,
): Promise<void> {
  if (await pathExists(provenancePath)) return;
  await fsp.mkdir(path.dirname(provenancePath), { recursive: true });
  await fsp.writeFile(
    provenancePath,
    JSON.stringify(
      {
        schemaVersion: NIXOS_SHARED_HOST_ARTIFACT_PROVENANCE_SCHEMA,
        artifactKind: artifact.kind,
        artifactIdentity: artifact.identity,
        storedArtifactPath: artifact.storedArtifactPath,
        admittedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function admitNixosSharedHostArtifact(opts: {
  recordsRoot: string;
  artifactDir: string;
  kind: ArtifactKind;
  stagingRoot?: string;
}): Promise<NixosSharedHostAdmittedArtifact> {
  const artifactDir = opts.stagingRoot
    ? await assertFinalizedStagedArtifactPath({
        artifactDir: opts.artifactDir,
        stagingRoot: opts.stagingRoot,
      })
    : path.resolve(opts.artifactDir);
  const identity = await artifactIdentityForNixosSharedHostDir(artifactDir, opts.kind);
  const artifact: NixosSharedHostAdmittedArtifact = {
    kind: opts.kind,
    identity,
    storedArtifactPath: artifactStoredPathFor(opts.recordsRoot, identity),
    provenancePath: artifactProvenancePathFor(opts.recordsRoot, identity),
  };
  await ensureStoredArtifact(artifactDir, artifact.storedArtifactPath);
  await ensureArtifactProvenance(artifact.provenancePath, artifact);
  return artifact;
}

export async function admitNixosSharedHostStaticArtifact(opts: {
  recordsRoot: string;
  artifactDir: string;
  stagingRoot?: string;
}): Promise<NixosSharedHostAdmittedArtifact> {
  return await admitNixosSharedHostArtifact({ ...opts, kind: "static-webapp" });
}

export async function artifactIdentityForStaticWebappDir(artifactDir: string): Promise<string> {
  return await artifactIdentityForNixosSharedHostDir(path.resolve(artifactDir), "static-webapp");
}

export async function requireNixosSharedHostAdmittedArtifactPath(
  artifact: NixosSharedHostAdmittedArtifact,
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
