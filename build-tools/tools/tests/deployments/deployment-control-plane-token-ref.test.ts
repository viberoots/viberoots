#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "../../deployments/deployment-service-client-selection";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { resolveControlPlaneTokenRef } from "../../deployments/deployment-control-plane-token-ref";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { startFakeVaultServer } from "./vault.test-server";

const STAGING_REF = "secret://control-plane/sample-webapp/staging/service-token";
const PROD_REF = "secret://control-plane/sample-webapp/prod/service-token";
const RUNTIME_REF = "runtime://github-actions/control-plane-token";

test("protected/shared control-plane token ref resolves through selected Infisical context", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [infisicalSecret(STAGING_REF, "selected-infisical-token")],
  );
  const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
  try {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(STAGING_REF, server.siteUrl),
      context: "cloudflare-pages shared_nonprod mutation",
      env: {},
    });
    assert.equal(client.controlPlaneToken, "selected-infisical-token");
    assert.equal(client.controlPlaneTokenRef, STAGING_REF);
  } finally {
    restore();
    await server.close();
  }
});

test("checked-in Sample webapp profile token refs use non-fixture Infisical backend path", async () => {
  for (const [ref, value] of [
    [STAGING_REF, "staging-control-plane-token"],
    [PROD_REF, "prod-control-plane-token"],
  ] as const) {
    const server = await startFakeInfisicalServer(
      { clientId: "id", clientSecret: "secret", accessToken: "token" },
      [infisicalSecret(ref, value)],
    );
    const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
    try {
      const client = await resolveProtectedSharedServiceClient({
        deployment: deployment(ref, server.siteUrl),
        context: "cloudflare-pages shared_nonprod mutation",
        env: {},
      });
      assert.equal(client.controlPlaneToken, value);
    } finally {
      restore();
      await server.close();
    }
  }
});

test("control-plane token ref resolves through selected Vault context", async () => {
  const server = await startFakeVaultServer({
    [STAGING_REF]: { currentVersion: "3", versions: { "3": { value: "vault-token" } } },
  });
  const token = await resolveControlPlaneTokenRef({
    tokenRef: STAGING_REF,
    backend: "vault",
    contextName: "sample-webapp-staging",
    secretContext: {
      kind: "vault",
      credential: { kind: "token", addr: server.addr, token: server.token },
    },
    env: {},
  });
  await server.close();
  assert.equal(token, "vault-token");
});

test("secret token refs fail closed without selected deployment secret context", async () => {
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment(STAGING_REF, "http://127.0.0.1"),
        context: "cloudflare-pages shared_nonprod mutation",
        env: {},
      }),
    /requires a selected real DeploymentSecretContext; rejected missing secretContext/,
  );
});

test("runtime token refs do not enter SprinkleRef secret backend resolver", async () => {
  await withProjectConfig(
    {
      runtimeHosts: {
        "github-actions": {
          bindings: { "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" } },
        },
      },
    },
    async () => {
      const client = await resolveProtectedSharedServiceClient({
        deployment: deployment(RUNTIME_REF, "http://127.0.0.1"),
        context: "cloudflare-pages shared_nonprod mutation",
        env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
      });
      assert.equal(client.controlPlaneToken, "runtime-token");
    },
  );
});

test("selection evidence records refs and never token payloads", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [infisicalSecret(STAGING_REF, "selected-infisical-token")],
  );
  const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
  try {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(STAGING_REF, server.siteUrl),
      context: "cloudflare-pages shared_nonprod mutation",
      env: {},
    });
    const evidence = JSON.stringify(serviceClientSelectionEvidence(client));
    assert.match(evidence, /secret:\/\/control-plane\/sample-webapp\/staging\/service-token/);
    assert.doesNotMatch(evidence, /selected-infisical-token|Bearer token|clientSecret/);
  } finally {
    restore();
    await server.close();
  }
});

test("token resolver redacts backend secret payloads in diagnostics", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "id",
    clientSecret: "secret",
    accessToken: "token",
    status: 401,
    echoClientSecretOnFailure: true,
  });
  const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
  try {
    await assert.rejects(
      () =>
        resolveProtectedSharedServiceClient({
          deployment: deployment(STAGING_REF, server.siteUrl),
          context: "cloudflare-pages shared_nonprod mutation",
          env: {},
        }),
      (error: unknown) => {
        const message = String(error instanceof Error ? error.message : error);
        assert.doesNotMatch(message, /"secret"|clientSecret":"secret|Bearer token/);
        assert.match(message, /clientSecret":"<redacted>"/);
        return true;
      },
    );
  } finally {
    restore();
    await server.close();
  }
});

function deployment(tokenRef: string, siteUrl: string) {
  const base = cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-staging",
    controlPlane: {
      name: "sample-webapp-staging",
      serviceClient: {
        controlPlaneUrl: "https://control-plane.example",
        controlPlaneTokenRef: tokenRef,
      },
      records: { backend: "service" },
    },
    deploymentContext: { name: "sample-webapp-staging" },
  });
  return {
    ...base,
    secretBackend: "infisical" as const,
    infisicalRuntime: {
      siteUrl,
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/",
    },
  };
}

function infisicalSecret(ref: string, secretValue: string) {
  return {
    id: `sec_${ref.includes("/prod/") ? "prod" : "staging"}`,
    projectId: "proj_123",
    environment: "prod",
    secretPath: "/",
    secretName: "service-token",
    version: "1",
    secretValue,
  };
}
