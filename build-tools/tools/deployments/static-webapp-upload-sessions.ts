#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize";
import {
  STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
  digestStaticWebappArtifactBundleBytes,
  materializeStaticWebappArtifactBundle,
  parseStaticWebappArtifactBundle,
} from "./static-webapp-artifact-bundle";
import {
  admitStaticWebappArtifact,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts";

export const STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA = "static-webapp-upload-session@1";
const UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000;

export type StaticWebappUploadSession = {
  schemaVersion: typeof STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA;
  uploadSessionId: string;
  submissionId: string;
  createdAt: string;
  expiresAt: string;
  archiveFormat: typeof STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA;
  archiveDigest: string;
  archivePath: string;
  sizeBytes: number;
};

function uploadSessionRoot(recordsRoot: string, uploadSessionId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "artifacts",
    "upload-sessions",
    sanitizeName(uploadSessionId),
  );
}

function metadataPath(recordsRoot: string, uploadSessionId: string): string {
  return path.join(uploadSessionRoot(recordsRoot, uploadSessionId), "session.json");
}

function archivePath(recordsRoot: string, uploadSessionId: string): string {
  return path.join(uploadSessionRoot(recordsRoot, uploadSessionId), "archive.json");
}

function materializedPath(recordsRoot: string, uploadSessionId: string): string {
  return path.join(uploadSessionRoot(recordsRoot, uploadSessionId), "materialized");
}

function createUploadSessionId(): string {
  return `upload-${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
}

async function readUploadSession(
  recordsRoot: string,
  uploadSessionId: string,
): Promise<StaticWebappUploadSession> {
  const session = JSON.parse(
    await fsp.readFile(metadataPath(recordsRoot, uploadSessionId), "utf8"),
  ) as StaticWebappUploadSession;
  if (session.schemaVersion !== STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA) {
    throw new Error(`unsupported static-webapp upload session: ${session.schemaVersion}`);
  }
  return session;
}

export async function createStaticWebappUploadSession(opts: {
  recordsRoot: string;
  submissionId: string;
  archiveBytes: Buffer;
}): Promise<StaticWebappUploadSession> {
  parseStaticWebappArtifactBundle(opts.archiveBytes);
  const uploadSessionId = createUploadSessionId();
  const root = uploadSessionRoot(opts.recordsRoot, uploadSessionId);
  const createdAt = new Date();
  const session: StaticWebappUploadSession = {
    schemaVersion: STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA,
    uploadSessionId,
    submissionId: opts.submissionId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + UPLOAD_SESSION_TTL_MS).toISOString(),
    archiveFormat: STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
    archiveDigest: digestStaticWebappArtifactBundleBytes(opts.archiveBytes),
    archivePath: archivePath(opts.recordsRoot, uploadSessionId),
    sizeBytes: opts.archiveBytes.byteLength,
  };
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(session.archivePath, opts.archiveBytes);
  await fsp.writeFile(
    metadataPath(opts.recordsRoot, uploadSessionId),
    JSON.stringify(session) + "\n",
  );
  return session;
}

export async function admitStaticWebappUploadSession(opts: {
  recordsRoot: string;
  uploadSessionId: string;
  submissionId: string;
  deploymentLabel: string;
  sourceRevision: string;
  buildTarget: string;
}): Promise<AdmittedStaticWebappArtifact> {
  const session = await readUploadSession(opts.recordsRoot, opts.uploadSessionId);
  if (session.submissionId !== opts.submissionId) {
    throw new Error("static-webapp upload session is not bound to this submission");
  }
  if (Date.now() > Date.parse(session.expiresAt)) {
    throw new Error(`static-webapp upload session expired: ${session.uploadSessionId}`);
  }
  const archiveBytes = await fsp.readFile(session.archivePath);
  if (digestStaticWebappArtifactBundleBytes(archiveBytes) !== session.archiveDigest) {
    throw new Error(`static-webapp upload session digest mismatch: ${session.uploadSessionId}`);
  }
  const materialized = materializedPath(opts.recordsRoot, opts.uploadSessionId);
  await materializeStaticWebappArtifactBundle(archiveBytes, materialized);
  return await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir: materialized,
    producer: {
      producerKind: "client_upload",
      sourceRevision: opts.sourceRevision,
      deploymentLabel: opts.deploymentLabel,
      buildTarget: opts.buildTarget,
      storageReference: `upload-session:${session.uploadSessionId}`,
      archiveDigest: session.archiveDigest,
      archiveFormat: session.archiveFormat,
    },
  });
}
