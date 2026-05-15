#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { newDb } from "pg-mem";
import pg from "pg";

export type NixosSharedHostControlPlaneBackendTarget = {
  recordsRoot: string;
  databaseUrl: string;
};

export type BackendRow = Record<string, unknown>;

export type BackendQueryResult<T extends BackendRow = BackendRow> = {
  rows: T[];
};

export type BackendQueryable = {
  query<T extends BackendRow = BackendRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<BackendQueryResult<T>>;
};

type BackendClient = BackendQueryable & {
  release(): void;
};

type BackendPool = BackendQueryable & {
  connect(): Promise<BackendClient>;
};

const LOCAL_BACKEND_URL_PREFIX = "pgmem://";
const backendPools = new Map<string, Promise<BackendPool>>();
const Pool = pg.Pool;

export function isLocalHarnessDatabaseUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith(LOCAL_BACKEND_URL_PREFIX);
}

export function localHarnessControlPlaneDatabaseUrl(recordsRoot: string): string {
  const key = crypto.createHash("sha256").update(path.resolve(recordsRoot)).digest("hex");
  return `${LOCAL_BACKEND_URL_PREFIX}${key}`;
}

async function initializeBackendSchema(pool: BackendPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      submission_id TEXT PRIMARY KEY,
      submission_path TEXT NOT NULL,
      execution_snapshot_path TEXT NOT NULL,
      lock_scope TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      deploy_run_id TEXT,
      completed_at TIMESTAMPTZ,
      document_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS submissions_by_deploy_run_id ON submissions(deploy_run_id);
    CREATE TABLE IF NOT EXISTS snapshots (
      submission_id TEXT PRIMARY KEY,
      execution_snapshot_path TEXT NOT NULL,
      document_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue (
      submission_id TEXT PRIMARY KEY,
      enqueued_at TIMESTAMPTZ NOT NULL,
      claimed_by TEXT,
      claim_token TEXT,
      claim_expires_at BIGINT,
      completed_at TIMESTAMPTZ
    );
    ALTER TABLE queue ADD COLUMN IF NOT EXISTS claim_token TEXT;
    CREATE TABLE IF NOT EXISTS idempotency (
      kind TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY(kind, key_hash)
    );
    CREATE TABLE IF NOT EXISTS artifact_challenges (
      challenge_id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at_ms BIGINT NOT NULL,
      used_at TIMESTAMPTZ,
      principal_id TEXT NOT NULL,
      key_id TEXT NOT NULL,
      binding_json JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_actions (
      action_id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locks (
      lock_scope TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      fencing_token TEXT NOT NULL,
      lease_expires_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deploy_records (
      deploy_run_id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      record_path TEXT NOT NULL,
      document_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deploy_records_by_submission_id
      ON deploy_records(submission_id);
    CREATE TABLE IF NOT EXISTS current_stage_state (
      deployment_id TEXT NOT NULL,
      environment_stage TEXT NOT NULL,
      current_run_id TEXT NOT NULL,
      document_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(deployment_id, environment_stage)
    );
    CREATE TABLE IF NOT EXISTS stage_state_history (
      deployment_id TEXT NOT NULL,
      environment_stage TEXT NOT NULL,
      deploy_run_id TEXT NOT NULL,
      document_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(deployment_id, environment_stage, deploy_run_id)
    );
    CREATE TABLE IF NOT EXISTS stage_state_audit_events (
      event_id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      environment_stage TEXT NOT NULL,
      deploy_run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      content_hash TEXT,
      event_hash TEXT,
      audit_sequence INTEGER,
      document_json JSONB NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS content_hash TEXT;
    ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
    ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS audit_sequence INTEGER;
    CREATE TABLE IF NOT EXISTS control_plane_audit_events (
      event_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      operation TEXT NOT NULL,
      idempotency_key TEXT,
      deployment_id TEXT NOT NULL,
      result TEXT NOT NULL,
      failure_summary TEXT,
      document_json JSONB NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS control_plane_audit_by_deployment
      ON control_plane_audit_events(deployment_id, occurred_at);
    CREATE TABLE IF NOT EXISTS artifact_cleanup_janitor_records (
      record_id TEXT PRIMARY KEY,
      submission_id TEXT,
      deployment_id TEXT,
      reason TEXT NOT NULL,
      document_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
}

async function createBackendPool(databaseUrl: string): Promise<BackendPool> {
  if (isLocalHarnessDatabaseUrl(databaseUrl)) {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    });
    const adapter = db.adapters.createPg();
    return new adapter.Pool() as BackendPool;
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  }) as BackendPool;
}

async function backendPoolFor(databaseUrl: string): Promise<BackendPool> {
  let poolPromise = backendPools.get(databaseUrl);
  if (!poolPromise) {
    poolPromise = (async () => {
      const pool = await createBackendPool(databaseUrl);
      await initializeBackendSchema(pool);
      return pool;
    })();
    backendPools.set(databaseUrl, poolPromise);
  }
  try {
    return await poolPromise;
  } catch (error) {
    backendPools.delete(databaseUrl);
    throw error;
  }
}

export async function queryBackend<T extends BackendRow = BackendRow>(
  backend: NixosSharedHostControlPlaneBackendTarget,
  sql: string,
  params: readonly unknown[] = [],
) {
  const pool = await backendPoolFor(backend.databaseUrl);
  return await pool.query<T>(sql, params);
}

export async function withBackendClient<T>(
  backend: NixosSharedHostControlPlaneBackendTarget,
  fn: (client: BackendClient) => Promise<T>,
) {
  const pool = await backendPoolFor(backend.databaseUrl);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function decodeBackendJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
}
