#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { test } from "node:test";
import {
  authenticateDeploymentAuthProviderToken,
  authenticateLocalAuthProviderClaims,
} from "../../deployments/deployment-auth-provider";
import { normalizeAuthProviderConfig } from "../../deployments/deployment-auth-provider-config";
import {
  authorizeControlPlaneAdmissionReport,
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
} from "../../deployments/deployment-control-plane-authz";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

function deployment() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    lanePolicyRef: "//projects/deployments/sample-webapp/shared:lane",
    environmentStage: "dev",
  });
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
    jwksUrl: string;
    token: string;
    mint: (claims: Record<string, unknown>, kid?: string) => string;
  }) => Promise<void>,
) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const server = await startJwksServer({ keys: [{ ...jwk, kid: "k1", use: "sig", alg: "RS256" }] });
  try {
    await fn({
      jwksUrl: server.url,
      mint: (claims, kid) => mintToken(privateKey, claims, kid),
      token: mintToken(privateKey, {
        iss: "https://auth.example.test",
        aud: "deployments-control-plane",
        exp: 2_000_000_000,
        sub: "operator-1",
        email: "operator@example.test",
        groups: ["deployer", "admission", "admin"],
      }),
    });
  } finally {
    await server.close();
  }
}

test("runtime auth provider contract keeps local adapter defaults", () => {
  const config = normalizeAuthProviderConfig(undefined);

  assert.equal(config.kind, "local-oidc");
  assert.equal(config.callback.externalPath, "/oidc/callback");
  assert.equal(config.claims.roleClaim, "groups");
  const auth = authenticateLocalAuthProviderClaims({
    deployment: deployment(),
    claims: { sub: "operator-1", groups: ["deploy-submitters-sample-webapp-dev"] },
  });
  assert.equal(auth.authorization.grants[0]?.role, "submitter");
});

test("generic OIDC JWKS provider verifies tokens and maps reviewed roles", async () => {
  await withProvider(async ({ jwksUrl, token }) => {
    const config = normalizeAuthProviderConfig({
      issuer: "https://auth.example.test",
      audience: ["deployments-control-plane"],
      jwksUrl,
      roleGroups: { deployer: ["deployer"], admissionReporter: ["admission"], admin: ["admin"] },
    });
    const auth = await authenticateDeploymentAuthProviderToken({
      config,
      deployment: deployment(),
      token,
      now: new Date("2026-01-01T00:00:00Z"),
    });

    assert.equal(auth.principal.principalId, "oidc:operator-1");
    assert.deepEqual(auth.reviewedIdentityAdminGroups, [
      "deploy-admin-identity-membership-admin-global",
    ]);
    assert.equal(
      authorizeControlPlaneSubmit({
        deployment: deployment(),
        operationKind: "deploy",
        authorization: auth.authorization,
      }).role,
      "submitter",
    );
    assert.equal(
      authorizeControlPlaneRunAction({
        deployment: deployment(),
        action: "approve",
        authorization: auth.authorization,
      }).role,
      "approver",
    );
    assert.equal(
      authorizeControlPlaneAdmissionReport({
        deployment: deployment(),
        authorization: auth.authorization,
      }).role,
      "admission_reporter",
    );
  });
});

test("generic OIDC JWKS provider maps service principals to stable audit identity", async () => {
  await withProvider(async ({ jwksUrl, mint }) => {
    const config = normalizeAuthProviderConfig({
      issuer: "https://auth.example.test",
      audience: ["deployments-control-plane"],
      jwksUrl,
      servicePrincipals: { "ci-deployer": "jenkins" },
    });
    const auth = await authenticateDeploymentAuthProviderToken({
      config,
      deployment: deployment(),
      token: mint({
        iss: "https://auth.example.test",
        aud: "deployments-control-plane",
        exp: 2_000_000_000,
        sub: "provider-random-subject",
        azp: "ci-deployer",
      }),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    assert.equal(auth.authorization.requestedBy.principalId, "oidc:service-account-jenkins");
    assert.equal(
      authorizeControlPlaneSubmit({
        deployment: deployment(),
        operationKind: "deploy",
        authorization: auth.authorization,
      }).role,
      "submitter",
    );
    assert.equal(
      authorizeControlPlaneAdmissionReport({
        deployment: deployment(),
        authorization: auth.authorization,
      }).role,
      "admission_reporter",
    );
  });
});

test("generic OIDC JWKS provider fails closed for unsafe tokens", async () => {
  await withProvider(async ({ jwksUrl, token, mint }) => {
    const baseConfig = {
      issuer: "https://auth.example.test",
      jwksUrl,
      roleGroups: { deployer: ["deployer"], admissionReporter: [], admin: [] },
    };
    const config = normalizeAuthProviderConfig({ ...baseConfig, audience: ["other-audience"] });
    await assert.rejects(
      () => authenticateDeploymentAuthProviderToken({ config, deployment: deployment(), token }),
      /audience mismatch/,
    );
    const validAudience = normalizeAuthProviderConfig({
      ...baseConfig,
      audience: ["deployments-control-plane"],
    });
    await assert.rejects(
      () =>
        authenticateDeploymentAuthProviderToken({
          config: validAudience,
          deployment: deployment(),
          token: mint({
            iss: "https://auth.example.test",
            aud: "deployments-control-plane",
            exp: 1,
            sub: "operator-1",
            groups: ["deployer"],
          }),
        }),
      /expired/,
    );
    await assert.rejects(
      () =>
        authenticateDeploymentAuthProviderToken({
          config: validAudience,
          deployment: deployment(),
          token: mint({
            iss: "https://auth.example.test",
            aud: "deployments-control-plane",
            exp: 2_000_000_000,
            sub: "operator-1",
          }),
        }),
      /missing role claim/,
    );
    await assert.rejects(
      () =>
        authenticateDeploymentAuthProviderToken({
          config: validAudience,
          deployment: deployment(),
          token: mint(
            {
              iss: "https://auth.example.test",
              aud: "deployments-control-plane",
              exp: 2_000_000_000,
              sub: "operator-1",
              groups: ["deployer"],
            },
            "rotated",
          ),
        }),
      /JWKS key not found/,
    );
  });
});
