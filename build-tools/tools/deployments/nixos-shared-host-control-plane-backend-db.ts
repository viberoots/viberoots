#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { newDb } from "pg-mem";
import pg from "pg";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_BACKEND_SCHEMA_SQL } from "./nixos-shared-host-control-plane-backend-schema";

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
  await pool.query(NIXOS_SHARED_HOST_CONTROL_PLANE_BACKEND_SCHEMA_SQL);
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
