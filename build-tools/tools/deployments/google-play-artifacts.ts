#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize";

export const GOOGLE_PLAY_ARTIFACT_PROVENANCE_SCHEMA = "google-play-artifact-provenance@1";

export type AdmittedGooglePlayArtifact = {
  kind: "mobile-app";
  identity: string;
  storedArtifactPath: string;
  provenancePath: string;
  filename: string;
};

async function resolveArtifactFile(inputPath: string): Promise<string> {
  const stat = await fsp.stat(inputPath);
  if (stat.isFile()) return inputPath;
  const matches = (await fsp.readdir(inputPath))
    .filter((entry) => entry.endsWith(".aab"))
    .sort()
    .map((entry) => path.join(inputPath, entry));
  if (matches.length !== 1) {
    throw new Error(`mobile-app artifact path must resolve to exactly one .aab file: ${inputPath}`);
  }
  return matches[0];
}

async function artifactIdentityForFile(artifactPath: string): Promise<string> {
  return `mobile-app:${crypto
    .createHash("sha256")
    .update(path.basename(artifactPath))
    .update("\n")
    .update(await fsp.readFile(artifactPath))
    .digest("hex")}`;
}

function storedArtifactPathFor(recordsRoot: string, identity: string, filename: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "artifacts",
    "blobs",
    sanitizeName(identity),
    filename,
  );
}

function provenancePathFor(recordsRoot: string, identity: string): string {
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

export async function admitGooglePlayArtifact(opts: {
  recordsRoot: string;
  artifactPath: string;
}): Promise<AdmittedGooglePlayArtifact> {
  const resolvedArtifactPath = await resolveArtifactFile(path.resolve(opts.artifactPath));
  const filename = path.basename(resolvedArtifactPath);
  const identity = await artifactIdentityForFile(resolvedArtifactPath);
  const artifact: AdmittedGooglePlayArtifact = {
    kind: "mobile-app",
    identity,
    storedArtifactPath: storedArtifactPathFor(opts.recordsRoot, identity, filename),
    provenancePath: provenancePathFor(opts.recordsRoot, identity),
    filename,
  };
  if (!(await pathExists(artifact.storedArtifactPath))) {
    await fsp.mkdir(path.dirname(artifact.storedArtifactPath), { recursive: true });
    await fsp.copyFile(resolvedArtifactPath, artifact.storedArtifactPath);
  }
  if (!(await pathExists(artifact.provenancePath))) {
    await fsp.mkdir(path.dirname(artifact.provenancePath), { recursive: true });
    await fsp.writeFile(
      artifact.provenancePath,
      JSON.stringify(
        {
          schemaVersion: GOOGLE_PLAY_ARTIFACT_PROVENANCE_SCHEMA,
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
  return artifact;
}

export async function requireAdmittedGooglePlayArtifactPath(
  artifact: AdmittedGooglePlayArtifact,
): Promise<string> {
  const storedArtifactPath = path.resolve(artifact.storedArtifactPath);
  try {
    const stat = await fsp.stat(storedArtifactPath);
    if (!stat.isFile()) throw new Error("stored artifact is not a file");
  } catch {
    throw new Error(
      `recorded exact artifact is unavailable: ${artifact.identity} (${storedArtifactPath})`,
    );
  }
  return storedArtifactPath;
}
