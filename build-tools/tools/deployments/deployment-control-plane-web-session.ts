#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

const SESSION_MS = 8 * 60 * 60 * 1000;

export type ControlPlaneWebSession = {
  sessionId: string;
  csrfToken: string;
  principal: { kind: "service_token"; principalId: string };
  grants: { read: true; mutations: false; deployments: "authorized_scope" };
  idempotency: { futureMutationKeys: "required" };
  expiresAt: string;
};

export type ControlPlaneWebSessionCreateResponse = {
  sessionId: string;
  principal: ControlPlaneWebSession["principal"];
  grants: ControlPlaneWebSession["grants"];
  expiresAt: string;
};

export type ControlPlaneWebAuthContext = {
  principal: ControlPlaneWebSession["principal"];
  grants: ControlPlaneWebSession["grants"];
};

export async function createControlPlaneWebSession(
  backend: NixosSharedHostControlPlaneBackendTarget,
): Promise<ControlPlaneWebSession> {
  const session = {
    sessionId: `cps_${randomId()}`,
    csrfToken: randomId(),
    principal: { kind: "service_token" as const, principalId: "reviewed-service-token" },
    grants: {
      read: true as const,
      mutations: false as const,
      deployments: "authorized_scope" as const,
    },
    idempotency: { futureMutationKeys: "required" as const },
    expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
  };
  await queryBackend(
    backend,
    `INSERT INTO control_plane_web_sessions(
       session_id, csrf_token, principal_json, grants_json, idempotency_json, created_at, expires_at
     ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      session.sessionId,
      session.csrfToken,
      JSON.stringify(session.principal),
      JSON.stringify(session.grants),
      JSON.stringify(session.idempotency),
      new Date().toISOString(),
      session.expiresAt,
    ],
  );
  return session;
}

export function publicControlPlaneWebSession(
  session: ControlPlaneWebSession,
): ControlPlaneWebSessionCreateResponse {
  return {
    sessionId: session.sessionId,
    principal: publicPrincipal(session),
    grants: publicGrants(),
    expiresAt: session.expiresAt,
  };
}

export function publicControlPlaneAuthContext(
  session: Pick<ControlPlaneWebSession, "principal" | "grants">,
): ControlPlaneWebAuthContext {
  return {
    principal: publicPrincipal(session),
    grants: publicGrants(),
  };
}

function publicPrincipal(session: Pick<ControlPlaneWebSession, "principal">) {
  return {
    kind: session.principal.kind,
    principalId: session.principal.principalId,
  };
}

function publicGrants(): ControlPlaneWebSession["grants"] {
  return { read: true, mutations: false, deployments: "authorized_scope" };
}

export async function readControlPlaneWebSession(
  backend: NixosSharedHostControlPlaneBackendTarget,
  sessionId: string,
): Promise<ControlPlaneWebSession | null> {
  const row = (
    await queryBackend<{
      session_id: string;
      csrf_token: string;
      principal_json: unknown;
      grants_json: unknown;
      idempotency_json: unknown;
      expires_at: string;
    }>(
      backend,
      `SELECT session_id, csrf_token, principal_json, grants_json, idempotency_json, expires_at
       FROM control_plane_web_sessions WHERE session_id = $1 AND expires_at > NOW()`,
      [sessionId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    principal: decodeBackendJson(row.principal_json),
    grants: decodeBackendJson(row.grants_json),
    idempotency: decodeBackendJson(row.idempotency_json),
    expiresAt: row.expires_at,
  };
}

function randomId(): string {
  return crypto.randomBytes(24).toString("base64url");
}
