#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import { authenticateDeploymentAuthProviderToken } from "../../deployments/deployment-auth-provider";
import { normalizeAuthProviderConfig } from "../../deployments/deployment-auth-provider-config";
import { readBackendControlPlaneAuditEvents } from "../../deployments/deployment-control-plane-audit";
import { resolveSubmitAuthorizationBoundary } from "../../deployments/deployment-service-authorization-boundary";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

function deployment() {
  return {
    ...nixosSharedHostDeploymentFixture({
      deploymentId: "pleomino-dev",
      label: "//projects/deployments/pleomino/dev:deploy",
      lanePolicyRef: "//projects/deployments/pleomino/shared:lane",
      environmentStage: "dev",
    }),
    vaultRuntime: { oidcIssuer: "https://auth.example.test", audience: "deployments-vault" },
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function startJwksServer(jwks: unknown) {
  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/jwks`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function mintToken(privateKey: crypto.KeyObject, claims: Record<string, unknown>, kid = "k1") {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT", kid });
  const payload = base64UrlJson(claims);
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

async function withProvider(
  fn: (opts: {
    authProvider: ReturnType<typeof normalizeAuthProviderConfig>;
    token: string;
    mint: (claims: Record<string, unknown>) => string;
  }) => Promise<void>,
) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const server = await startJwksServer({ keys: [{ ...jwk, kid: "k1", use: "sig", alg: "RS256" }] });
  try {
    const authProvider = normalizeAuthProviderConfig({
      issuer: "https://auth.example.test",
      audience: ["deployments-control-plane"],
      jwksUrl: server.url,
      callback: { externalHost: "deploy-auth.example.test", externalPath: "/sso/callback" },
      roleGroups: { deployer: ["deployer"], admissionReporter: ["admission"], admin: [] },
    });
    await fn({
      authProvider,
      mint: (claims) => mintToken(privateKey, claims),
      token: mintToken(privateKey, {
        iss: "https://auth.example.test",
        aud: "deployments-control-plane",
        exp: 2_000_000_000,
        sub: "operator-1",
        email: "operator@example.test",
        groups: ["deployer", "admission"],
      }),
    });
  } finally {
    await server.close();
  }
}

test("configured hosted provider fails closed for missing and mismatched issuer", async () => {
  await withProvider(async ({ authProvider, mint }) => {
    await assert.rejects(
      () =>
        authenticateDeploymentAuthProviderToken({
          config: authProvider,
          deployment: deployment(),
          token: mint({
            aud: "deployments-control-plane",
            exp: 2_000_000_000,
            sub: "operator-1",
            groups: ["deployer"],
          }),
        }),
      /missing issuer claim/,
    );
    await assert.rejects(
      () =>
        authenticateDeploymentAuthProviderToken({
          config: authProvider,
          deployment: deployment(),
          token: mint({
            iss: "https://wrong.example.test",
            aud: "deployments-control-plane",
            exp: 2_000_000_000,
            sub: "operator-1",
            groups: ["deployer"],
          }),
        }),
      /issuer mismatch/,
    );
  });
});

test("configured hosted provider authorizes protected submit requests", async () => {
  await withProvider(async ({ authProvider, token }) => {
    const request = {
      schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      deployment: deployment(),
    };
    const boundary = await resolveSubmitAuthorizationBoundary({
      recordsRoot: "/tmp/provider-auth-boundary",
      deployment: deployment(),
      operationKind: "deploy",
      request,
      authProvider,
      authorizationHeader: `Bearer ${token}`,
    });

    assert.equal(boundary.requestedBy?.principalId, "oidc:operator-1");
    assert.equal(boundary.authorization?.grants[0]?.role, "submitter");
  });
});

test("configured callback path is accepted by server ingress", async () => {
  await runInTemp("control-plane-auth-provider-callback-path", async (tmp) => {
    await withProvider(async ({ authProvider }) => {
      const controlPlane = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths: {
          statePath: `${tmp}/platform-state.json`,
          hostRoot: `${tmp}/host`,
          recordsRoot: `${tmp}/records`,
        },
        backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(`${tmp}/records`),
        localFixture: true,
        authProvider,
      });
      try {
        const portable = new URL("/sso/callback", controlPlane.url);
        portable.searchParams.set("code", "login-code");
        portable.searchParams.set("state", "missing-state");
        assert.equal((await fetch(portable)).status, 400);
        const miniPath = new URL("/oidc/callback", controlPlane.url);
        miniPath.searchParams.set("code", "login-code");
        miniPath.searchParams.set("state", "missing-state");
        assert.equal((await fetch(miniPath)).status, 404);
      } finally {
        await controlPlane.close();
      }
    });
  });
});

test("hosted provider principal is written to durable audit rows", async () => {
  await runInTemp("control-plane-auth-provider-audit", async (tmp) => {
    await withProvider(async ({ authProvider, token }) => {
      const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
      const auth = await authenticateDeploymentAuthProviderToken({
        config: authProvider,
        deployment: deployment(),
        token,
        now: new Date("2026-01-01T00:00:00Z"),
      });
      await writeBackendSubmissionDoc(
        backend,
        {
          submissionId: "provider-audit-submit",
          submittedAt: "2026-05-01T10:00:00.000Z",
          deploymentId: "pleomino-dev",
          operationKind: "deploy",
          lockScope: "scope",
          executionSnapshotPath: "snapshot",
          lifecycleState: "finished",
          finalOutcome: "succeeded",
          requestedBy: auth.authorization.requestedBy,
        },
        { submissionPath: "submission", executionSnapshotPath: "snapshot" },
      );
      const audit = await readBackendControlPlaneAuditEvents(backend, "pleomino-dev");
      assert.equal(audit[0]?.actor, "oidc:operator-1");
      assert.equal(audit[0]?.operation, "deploy");
    });
  });
});
