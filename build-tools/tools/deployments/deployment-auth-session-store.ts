#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
  type DeploymentAuthSessionRecord,
} from "./deployment-auth-session-types";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

export type DeploymentAuthSessionStoreTarget =
  | string
  | { recordsRoot: string; backend?: NixosSharedHostControlPlaneBackendTarget };

function authSessionDir(recordsRoot: string): string {
  return path.join(recordsRoot, "control-plane", "auth-sessions");
}

function authSessionPath(recordsRoot: string, sessionId: string): string {
  return path.join(authSessionDir(recordsRoot), `${sessionId}.json`);
}

async function readSessionFile(file: string): Promise<DeploymentAuthSessionRecord | undefined> {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8")) as DeploymentAuthSessionRecord;
    if (parsed.schemaVersion !== DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA) {
      throw new Error(`unsupported auth session schema: ${parsed.schemaVersion}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function storeTarget(target: DeploymentAuthSessionStoreTarget) {
  return typeof target === "string" ? { recordsRoot: target } : target;
}

function assertSessionSchema(session: DeploymentAuthSessionRecord) {
  if (session.schemaVersion !== DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA) {
    throw new Error(`unsupported auth session schema: ${session.schemaVersion}`);
  }
  return session;
}

export async function writeDeploymentAuthSession(
  target: DeploymentAuthSessionStoreTarget,
  session: DeploymentAuthSessionRecord,
) {
  const store = storeTarget(target);
  assertSessionSchema(session);
  if (store.backend) {
    await queryBackend(
      store.backend,
      `INSERT INTO deployment_auth_sessions(session_id, state, document_json, expires_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         state = EXCLUDED.state,
         document_json = EXCLUDED.document_json,
         expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at`,
      [
        session.sessionId,
        session.state,
        JSON.stringify(session),
        session.expiresAt,
        new Date().toISOString(),
      ],
    );
    return;
  }
  await writeControlPlaneJson(authSessionPath(store.recordsRoot, session.sessionId), session);
}

export async function readDeploymentAuthSession(
  target: DeploymentAuthSessionStoreTarget,
  sessionId: string,
) {
  const store = storeTarget(target);
  if (store.backend) {
    const row = (
      await queryBackend<{ document_json: unknown }>(
        store.backend,
        `SELECT document_json FROM deployment_auth_sessions WHERE session_id = $1`,
        [sessionId],
      )
    ).rows[0];
    if (!row) return undefined;
    return await expireDeploymentAuthSession(
      store,
      assertSessionSchema(decodeBackendJson(row.document_json)),
    );
  }
  const session = await readSessionFile(authSessionPath(store.recordsRoot, sessionId));
  if (!session) return undefined;
  return await expireDeploymentAuthSession(store, session);
}

export async function findDeploymentAuthSessionByState(
  target: DeploymentAuthSessionStoreTarget,
  state: string,
) {
  const store = storeTarget(target);
  if (store.backend) {
    const row = (
      await queryBackend<{ document_json: unknown }>(
        store.backend,
        `SELECT document_json FROM deployment_auth_sessions WHERE state = $1`,
        [state],
      )
    ).rows[0];
    if (!row) return undefined;
    return await expireDeploymentAuthSession(
      store,
      assertSessionSchema(decodeBackendJson(row.document_json)),
    );
  }
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(authSessionDir(store.recordsRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const session = await readSessionFile(path.join(authSessionDir(store.recordsRoot), entry));
    if (session?.state === state) return await expireDeploymentAuthSession(store, session);
  }
  return undefined;
}

export async function expireDeploymentAuthSession(
  target: DeploymentAuthSessionStoreTarget,
  session: DeploymentAuthSessionRecord,
) {
  if (
    !["pending", "authenticated"].includes(session.status) ||
    Date.now() < Date.parse(session.expiresAt)
  ) {
    return session;
  }
  const expired = { ...session, status: "expired" as const, failure: "auth session expired" };
  await writeDeploymentAuthSession(target, expired);
  return expired;
}
