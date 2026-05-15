#!/usr/bin/env zx-wrapper
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type {
  BackendQueryable,
  NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";
import type { ControlPlaneArtifactObject } from "./control-plane-artifact-store-types";

export async function writeBackendArtifactObjectMetadata(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget | BackendQueryable;
  object: ControlPlaneArtifactObject;
}) {
  const sql = `INSERT INTO artifact_objects (
       object_key, bucket, digest, size_bytes, content_type, provenance_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT(object_key) DO UPDATE SET
       bucket = EXCLUDED.bucket,
       digest = EXCLUDED.digest,
       size_bytes = EXCLUDED.size_bytes,
       content_type = EXCLUDED.content_type,
       provenance_json = EXCLUDED.provenance_json`;
  const params = [
    opts.object.key,
    opts.object.bucket,
    opts.object.digest,
    opts.object.size,
    opts.object.contentType,
    JSON.stringify(opts.object.provenance),
    new Date().toISOString(),
  ];
  if ("query" in opts.backend) {
    await opts.backend.query(sql, params);
    return;
  }
  await queryBackend(opts.backend, sql, params);
}

export async function readBackendArtifactObjectMetadata(
  backend: NixosSharedHostControlPlaneBackendTarget,
  key: string,
) {
  return (
    await queryBackend(
      backend,
      "SELECT object_key, bucket, digest, size_bytes, content_type, provenance_json FROM artifact_objects WHERE object_key = $1",
      [key],
    )
  ).rows[0];
}
