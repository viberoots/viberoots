#!/usr/bin/env zx-wrapper
import { decodeBackendJson, queryBackend } from "./nixos-shared-host-control-plane-backend-db";
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
     ON CONFLICT(object_key) DO NOTHING`;
  const params = [
    opts.object.key,
    opts.object.bucket,
    opts.object.digest,
    opts.object.size,
    opts.object.contentType,
    JSON.stringify(opts.object.provenance),
    new Date().toISOString(),
  ];
  if ("query" in opts.backend) await opts.backend.query(sql, params);
  else await queryBackend(opts.backend, sql, params);
  const row = await readArtifactObjectRow(opts.backend, opts.object.key);
  if (!row) throw new Error(`artifact object metadata insert failed for ${opts.object.key}`);
  if (artifactRowMatches(row, opts.object)) return;
  throw new Error(`artifact object metadata conflicts with immutable key ${opts.object.key}`);
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

async function readArtifactObjectRow(
  backend: NixosSharedHostControlPlaneBackendTarget | BackendQueryable,
  key: string,
) {
  const sql =
    "SELECT object_key, bucket, digest, size_bytes, content_type, provenance_json FROM artifact_objects WHERE object_key = $1";
  if ("query" in backend) return (await backend.query(sql, [key])).rows[0];
  return (await queryBackend(backend, sql, [key])).rows[0];
}

function artifactRowMatches(row: any, object: ControlPlaneArtifactObject): boolean {
  return (
    row.bucket === object.bucket &&
    row.digest === object.digest &&
    Number(row.size_bytes) === object.size &&
    row.content_type === object.contentType &&
    JSON.stringify(sortObject(decodeBackendJson(row.provenance_json))) ===
      JSON.stringify(sortObject(object.provenance))
  );
}

function sortObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
