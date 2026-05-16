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
import {
  CONTROL_PLANE_ARTIFACT_CONTENT_TYPE,
  putVerifiedArtifactObject,
  readVerifiedArtifactObject,
} from "./control-plane-artifact-store";
import type {
  ControlPlaneArtifactObject,
  ControlPlaneArtifactStore,
} from "./control-plane-artifact-store-types";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

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
  archiveObject?: ControlPlaneArtifactObject;
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
  backend?: NixosSharedHostControlPlaneBackendTarget,
): Promise<StaticWebappUploadSession> {
  const session = backend
    ? await readUploadSessionFromBackend(backend, uploadSessionId)
    : (JSON.parse(
        await fsp.readFile(metadataPath(recordsRoot, uploadSessionId), "utf8"),
      ) as StaticWebappUploadSession);
  if (!session) throw new Error(`static-webapp upload session not found: ${uploadSessionId}`);
  if (session.schemaVersion !== STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA) {
    throw new Error(`unsupported static-webapp upload session: ${session.schemaVersion}`);
  }
  return session;
}

async function readUploadSessionFromBackend(
  backend: NixosSharedHostControlPlaneBackendTarget,
  uploadSessionId: string,
) {
  const row = (
    await queryBackend<{ document_json: unknown }>(
      backend,
      `SELECT document_json FROM static_webapp_upload_sessions WHERE upload_session_id = $1`,
      [uploadSessionId],
    )
  ).rows[0];
  return row ? decodeBackendJson<StaticWebappUploadSession>(row.document_json) : undefined;
}

async function writeUploadSessionMetadata(opts: {
  recordsRoot: string;
  session: StaticWebappUploadSession;
  backend?: NixosSharedHostControlPlaneBackendTarget;
}) {
  if (opts.backend) {
    await queryBackend(
      opts.backend,
      `INSERT INTO static_webapp_upload_sessions(
         upload_session_id, submission_id, document_json, expires_at, updated_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (upload_session_id) DO UPDATE SET
         submission_id = EXCLUDED.submission_id,
         document_json = EXCLUDED.document_json,
         expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at`,
      [
        opts.session.uploadSessionId,
        opts.session.submissionId,
        JSON.stringify(opts.session),
        opts.session.expiresAt,
        new Date().toISOString(),
      ],
    );
    return;
  }
  await fsp.writeFile(
    metadataPath(opts.recordsRoot, opts.session.uploadSessionId),
    JSON.stringify(opts.session) + "\n",
  );
}

export async function createStaticWebappUploadSession(opts: {
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  submissionId: string;
  archiveBytes: Buffer;
  objectStore?: ControlPlaneArtifactStore;
}): Promise<StaticWebappUploadSession> {
  parseStaticWebappArtifactBundle(opts.archiveBytes);
  const uploadSessionId = createUploadSessionId();
  const root = uploadSessionRoot(opts.recordsRoot, uploadSessionId);
  const createdAt = new Date();
  const archiveObject = opts.objectStore
    ? await putVerifiedArtifactObject({
        store: opts.objectStore,
        body: opts.archiveBytes,
        payloadKind: "artifact",
        contentType: CONTROL_PLANE_ARTIFACT_CONTENT_TYPE,
        provenance: { submissionId: opts.submissionId },
      })
    : undefined;
  const session: StaticWebappUploadSession = {
    schemaVersion: STATIC_WEBAPP_UPLOAD_SESSION_SCHEMA,
    uploadSessionId,
    submissionId: opts.submissionId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + UPLOAD_SESSION_TTL_MS).toISOString(),
    archiveFormat: STATIC_WEBAPP_ARTIFACT_BUNDLE_SCHEMA,
    archiveDigest: digestStaticWebappArtifactBundleBytes(opts.archiveBytes),
    archivePath: archivePath(opts.recordsRoot, uploadSessionId),
    ...(archiveObject ? { archiveObject } : {}),
    sizeBytes: opts.archiveBytes.byteLength,
  };
  if (!archiveObject || !opts.backend) await fsp.mkdir(root, { recursive: true });
  if (!archiveObject) await fsp.writeFile(session.archivePath, opts.archiveBytes);
  await writeUploadSessionMetadata({
    recordsRoot: opts.recordsRoot,
    session,
    ...(opts.backend ? { backend: opts.backend } : {}),
  });
  return session;
}

export async function admitStaticWebappUploadSession(opts: {
  recordsRoot: string;
  backend?: NixosSharedHostControlPlaneBackendTarget;
  uploadSessionId: string;
  submissionId: string;
  deploymentId?: string;
  deploymentLabel: string;
  sourceRevision: string;
  buildTarget: string;
  objectStore?: ControlPlaneArtifactStore;
}): Promise<AdmittedStaticWebappArtifact> {
  const session = await readUploadSession(opts.recordsRoot, opts.uploadSessionId, opts.backend);
  if (session.submissionId !== opts.submissionId) {
    throw new Error("static-webapp upload session is not bound to this submission");
  }
  if (Date.now() > Date.parse(session.expiresAt)) {
    throw new Error(`static-webapp upload session expired: ${session.uploadSessionId}`);
  }
  if (session.archiveObject && !opts.objectStore) {
    throw new Error("artifact object store is required for upload session admission");
  }
  const archiveBytes = session.archiveObject
    ? await readVerifiedArtifactObject({ store: opts.objectStore!, object: session.archiveObject })
    : await fsp.readFile(session.archivePath);
  if (digestStaticWebappArtifactBundleBytes(archiveBytes) !== session.archiveDigest) {
    throw new Error(`static-webapp upload session digest mismatch: ${session.uploadSessionId}`);
  }
  const materialized = materializedPath(opts.recordsRoot, opts.uploadSessionId);
  await materializeStaticWebappArtifactBundle(archiveBytes, materialized);
  return await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir: materialized,
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    ...(opts.deploymentId ? { deploymentId: opts.deploymentId } : {}),
    submissionId: opts.submissionId,
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
