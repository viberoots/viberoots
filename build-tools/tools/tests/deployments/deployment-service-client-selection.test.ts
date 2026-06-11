#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "../../deployments/deployment-service-client-selection";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";
import { startFakeVaultServer } from "./vault.test-server";

const SECRET_REF = "secret://control-planes/prod/service-token";
const RUNTIME_REF = "runtime://github-actions/control-plane-token";

function deployment(tokenRef = RUNTIME_REF) {
  const base = cloudflarePagesDeploymentFixture({
    controlPlane: {
      name: "prod",
      serviceClient: {
        controlPlaneUrl: "https://control.prod.example",
        controlPlaneTokenRef: tokenRef,
      },
      records: { backend: "service" },
    },
    deploymentContext: {
      name: "prod",
      controlPlane: {
        name: "prod",
        serviceClient: {
          controlPlaneUrl: "https://control.prod.example",
          controlPlaneTokenRef: tokenRef,
        },
        records: { backend: "service" },
      },
    },
  });
  return {
    ...base,
    ...(tokenRef.startsWith("secret://") ? { secretBackend: "vault" as const } : {}),
  };
}

test("context-selected control plane supplies URL and resolves secret token ref", async () => {
  await withVaultSecretContext(async () => {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(SECRET_REF),
      context: "cloudflare-pages shared_nonprod mutation",
      env: {},
    });
    assert.equal(client.controlPlaneUrl, "https://control.prod.example");
    assert.equal(client.controlPlaneToken, "resolved-secret-token");
    assert.equal(client.selectedSource, "context");
    assert.equal(client.controlPlaneTokenRef, SECRET_REF);
  });
});

test("runtime token ref reads host binding without using SprinkleRef", async () => {
  await withRuntimeHostConfig(async () => {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      context: "cloudflare-pages shared_nonprod mutation",
      env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
    });
    assert.equal(client.controlPlaneUrl, "https://control.prod.example");
    assert.equal(client.controlPlaneToken, "runtime-token");
    assert.equal(client.selectedSource, "context");
  });
});

test("context-selected control plane rejects disagreeing explicit and ambient URLs", async () => {
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment(),
        controlPlaneUrl: "https://other.example",
        context: "cloudflare-pages shared_nonprod mutation",
        env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
      }),
    /disagrees with deployment context controlPlane prod/,
  );
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment(),
        context: "cloudflare-pages shared_nonprod mutation",
        env: {
          VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
          DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token",
        },
      }),
    /VBR_DEPLOY_CONTROL_PLANE_URL .* disagrees/,
  );
});

test("context-selected control plane rejects remote alias override", async () => {
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment(),
        remote: "mini",
        context: "nixos-shared-host shared_nonprod mutation",
        env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
      }),
    /--remote cannot override deployment context controlPlane/,
  );
});

test("protected/shared deployment context without control plane rejects URL fallback", async () => {
  const missingControlPlane = cloudflarePagesDeploymentFixture({
    controlPlane: undefined,
    deploymentContext: { name: "prod" } as any,
  });
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: missingControlPlane,
        controlPlaneUrl: "https://explicit.example",
        context: "cloudflare-pages shared_nonprod mutation",
        env: {
          VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
          VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token",
        },
      }),
    /deployment context prod must select a valid controlPlane/,
  );
});

test("context-selected control plane rejects unresolvable token refs before fallback", async () => {
  await withRuntimeHostConfig(async () => {
    await assert.rejects(
      () =>
        resolveProtectedSharedServiceClient({
          deployment: deployment(),
          context: "cloudflare-pages shared_nonprod mutation",
          env: { VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token" },
        }),
      /runtime control-plane token binding is unset: DEPLOY_CONTROL_PLANE_TOKEN/,
    );
  });
});

test("explicit override requires allow flag and records selected source", async () => {
  await withRuntimeHostConfig(async () => {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      controlPlaneUrl: "https://override.example",
      allowControlPlaneOverride: true,
      context: "cloudflare-pages shared_nonprod mutation",
      env: {
        DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token",
        VBR_DEPLOY_CONTROL_PLANE_TOKEN: "ambient-token",
      },
    });
    assert.equal(client.controlPlaneUrl, "https://override.example");
    assert.equal(client.controlPlaneToken, "runtime-token");
    assert.equal(client.selectedSource, "explicit_override");
    assert.equal(client.controlPlaneName, "prod");
    assert.deepEqual(serviceClientSelectionEvidence(client), {
      source: "explicit_override",
      controlPlaneUrl: "https://override.example",
      controlPlaneName: "prod",
      controlPlaneTokenRef: RUNTIME_REF,
    });
  });
});

test("selected control plane rejects raw token override even with URL override allowed", async () => {
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment(),
        controlPlaneUrl: "https://override.example",
        controlPlaneToken: "override-token",
        allowControlPlaneOverride: true,
        context: "cloudflare-pages shared_nonprod mutation",
        env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
      }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /--control-plane-token cannot override/);
      assert.match(error.message, /runtime:\/\/github-actions\/control-plane-token/);
      assert.doesNotMatch(error.message, /override-token|runtime-token/);
      return true;
    },
  );
});

test("commands without context keep explicit and ambient fallback order", async () => {
  const noContext = cloudflarePagesDeploymentFixture({ controlPlane: undefined });
  assert.equal(
    (
      await resolveProtectedSharedServiceClient({
        deployment: noContext,
        controlPlaneUrl: "https://explicit.example",
        context: "cloudflare-pages shared_nonprod mutation",
        env: { VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example" },
      })
    ).selectedSource,
    "explicit",
  );
  assert.equal(
    (
      await resolveProtectedSharedServiceClient({
        deployment: noContext,
        context: "cloudflare-pages shared_nonprod mutation",
        env: { VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example" },
      })
    ).selectedSource,
    "ambient",
  );
});

function withRuntimeHostConfig(run: () => Promise<void>) {
  return withProjectConfig(
    {
      runtimeHosts: {
        "github-actions": {
          bindings: {
            "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" },
            "prod-control-plane-token": { kind: "env", name: "PROD_CONTROL_PLANE_TOKEN" },
          },
        },
      },
    },
    run,
  );
}

async function withVaultSecretContext(run: () => Promise<void>) {
  const server = await startFakeVaultServer({
    [SECRET_REF]: { currentVersion: "1", versions: { "1": { value: "resolved-secret-token" } } },
  });
  const restore = activateDeploymentSecretContext({
    kind: "vault",
    credential: { kind: "token", addr: server.addr, token: server.token },
  });
  try {
    await run();
  } finally {
    restore();
    await server.close();
  }
}
