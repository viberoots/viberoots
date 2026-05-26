#!/usr/bin/env zx-wrapper
import type { BackendQueryable } from "./nixos-shared-host-control-plane-backend-db";

const MIN_POSTGRES_VERSION_NUM = 120000;

export type ManagedPostgresConformanceResult = {
  serverVersionNum: number;
  checkedFeatures: string[];
};

export async function validateManagedPostgresFeatures(
  client: BackendQueryable,
): Promise<ManagedPostgresConformanceResult> {
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const serverVersionNum = await readServerVersionNum(client);
    if (serverVersionNum < MIN_POSTGRES_VERSION_NUM) {
      throw new Error(`Postgres ${MIN_POSTGRES_VERSION_NUM} or newer is required`);
    }
    await client.query(
      `CREATE TEMP TABLE vbr_control_plane_conformance_claims (
         id TEXT PRIMARY KEY,
         state TEXT NOT NULL,
         payload JSONB NOT NULL
       ) ON COMMIT DROP`,
    );
    await client.query(
      `INSERT INTO vbr_control_plane_conformance_claims (id, state, payload)
       VALUES ($1, $2, $3::jsonb)`,
      ["claim-one", "queued", JSON.stringify({ mode: "initial" })],
    );
    await client.query(
      `WITH candidate AS (
         SELECT id
         FROM vbr_control_plane_conformance_claims
         WHERE state = $1
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ),
       claimed AS (
         UPDATE vbr_control_plane_conformance_claims
         SET state = $2,
             payload = jsonb_build_object('mode', $3)
         FROM candidate
         WHERE vbr_control_plane_conformance_claims.id = candidate.id
         RETURNING vbr_control_plane_conformance_claims.id
       )
       SELECT id FROM claimed`,
      ["queued", "claimed", "claimed"],
    );
    await client.query(
      `INSERT INTO vbr_control_plane_conformance_claims (id, state, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT(id) DO UPDATE SET
         state = EXCLUDED.state,
         payload = EXCLUDED.payload
       RETURNING payload->>'mode' AS mode`,
      ["claim-one", "finished", JSON.stringify({ mode: "upserted" })],
    );
    await client.query("COMMIT");
    inTransaction = false;
    return {
      serverVersionNum,
      checkedFeatures: [
        "temporary tables",
        "jsonb",
        "common table expressions",
        "FOR UPDATE SKIP LOCKED",
        "INSERT ON CONFLICT",
        "RETURNING",
      ],
    };
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw Object.assign(
      new Error(`managed Postgres conformance check failed: ${errorMessage(error)}`),
      { code: "managed_postgres_conformance_failed" },
    );
  }
}

async function readServerVersionNum(client: BackendQueryable): Promise<number> {
  const row = (await client.query<{ server_version_num?: string }>("SHOW server_version_num"))
    .rows[0];
  const version = Number(row?.server_version_num);
  if (!Number.isInteger(version)) {
    throw new Error("server_version_num is unavailable");
  }
  return version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown database error";
}
