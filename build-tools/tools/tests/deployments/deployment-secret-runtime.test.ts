#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeploymentSecretRuntime,
  type DeploymentSecretBackend,
} from "../../deployments/deployment-secret-runtime";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";

function backendFor(
  resolve: (
    name: string,
    acquireCount: number,
  ) => Awaited<ReturnType<DeploymentSecretBackend["acquire"]>>,
  renew?: DeploymentSecretBackend["renew"],
): DeploymentSecretBackend {
  const acquireCounts = new Map<string, number>();
  return {
    async acquire(binding) {
      const count = acquireCounts.get(binding.name) || 0;
      acquireCounts.set(binding.name, count + 1);
      return await resolve(binding.name, count);
    },
    ...(renew ? { renew } : {}),
  };
}

test("secret runtime stays backend-agnostic while selecting least-privilege step credentials", async () => {
  const runtime = createDeploymentSecretRuntime({
    backend: backendFor(async (name) => ({
      binding: {
        name,
        step: name === "publish_token" ? "publish" : "smoke",
        contractId: `secret://${name}`,
        required: true,
        backend: "vault",
        referenceId: `vault:secret://${name}`,
      },
      value: `${name}-value`,
      allowedSteps: [name === "publish_token" ? "publish" : "smoke"],
      targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      credentialClass: "routine",
      refreshMode: "none",
    })),
    requirements: [
      deploymentRequirementFixture({
        name: "publish_token",
        step: "publish",
        contractId: "secret://publish_token",
      }),
      deploymentRequirementFixture({
        name: "smoke_token",
        step: "smoke",
        contractId: "secret://smoke_token",
      }),
    ],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });

  const publish = await runtime.enterStep("publish");
  const smoke = await runtime.enterStep("smoke");

  assert.deepEqual(Object.keys(publish), ["publish_token"]);
  assert.deepEqual(Object.keys(smoke), ["smoke_token"]);
});

test("secret runtime caches the same backend reference separately per lifecycle step", async () => {
  let acquireCalls = 0;
  const runtime = createDeploymentSecretRuntime({
    backend: {
      async acquire(binding) {
        acquireCalls += 1;
        return {
          binding,
          value: `${binding.step}-token`,
          allowedSteps: [binding.step],
          targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
          credentialClass: "routine",
          refreshMode: "none",
        };
      },
    },
    requirements: [
      deploymentRequirementFixture({
        name: "cloudflare_api_token",
        step: "provision",
        contractId: "secret://deployments/pleomino/cloudflare_api_token",
      }),
      deploymentRequirementFixture({
        name: "cloudflare_api_token",
        step: "publish",
        contractId: "secret://deployments/pleomino/cloudflare_api_token",
      }),
    ],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });

  assert.equal((await runtime.enterStep("provision")).cloudflare_api_token, "provision-token");
  assert.equal((await runtime.enterStep("publish")).cloudflare_api_token, "publish-token");
  assert.equal(acquireCalls, 2);
});

test("secret runtime renews an expired renewable credential without widening scope", async () => {
  let nowMs = Date.parse("2026-04-10T10:00:00.000Z");
  let renewCalls = 0;
  const runtime = createDeploymentSecretRuntime({
    backend: backendFor(
      async () => ({
        binding: {
          name: "publish_token",
          step: "publish",
          contractId: "secret://publish_token",
          required: true,
          backend: "vault",
          referenceId: "vault:secret://publish_token",
        },
        value: "first-token",
        allowedSteps: ["publish"],
        targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
        credentialClass: "routine",
        refreshMode: "renew",
        expiresAt: new Date(nowMs + 1_000).toISOString(),
      }),
      async (secret) => {
        renewCalls += 1;
        return {
          ...secret,
          value: "renewed-token",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
        };
      },
    ),
    requirements: [deploymentRequirementFixture({ name: "publish_token", step: "publish" })],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    now: () => new Date(nowMs),
  });

  await runtime.enterStep("publish");
  nowMs += 2_000;
  const refreshed = await runtime.enterStep("publish");

  assert.equal(renewCalls, 1);
  assert.equal(refreshed.publish_token, "renewed-token");
});

test("secret runtime reacquires an expired non-renewable credential", async () => {
  let nowMs = Date.parse("2026-04-10T10:00:00.000Z");
  const runtime = createDeploymentSecretRuntime({
    backend: backendFor(async (_name, acquireCount) => ({
      binding: {
        name: "publish_token",
        step: "publish",
        contractId: "secret://publish_token",
        required: true,
        backend: "vault",
        referenceId: "vault:secret://publish_token",
      },
      value: acquireCount === 0 ? "first-token" : "second-token",
      allowedSteps: ["publish"],
      targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      credentialClass: "routine",
      refreshMode: "reacquire",
      expiresAt: new Date(nowMs + 1_000).toISOString(),
    })),
    requirements: [deploymentRequirementFixture({ name: "publish_token", step: "publish" })],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    now: () => new Date(nowMs),
  });

  await runtime.enterStep("publish");
  nowMs += 2_000;
  const refreshed = await runtime.enterStep("publish");

  assert.equal(refreshed.publish_token, "second-token");
});

test("secret runtime fails closed when a required credential cannot be refreshed", async () => {
  let nowMs = Date.parse("2026-04-10T10:00:00.000Z");
  const runtime = createDeploymentSecretRuntime({
    backend: backendFor(async () => ({
      binding: {
        name: "publish_token",
        step: "publish",
        contractId: "secret://publish_token",
        required: true,
        backend: "vault",
        referenceId: "vault:secret://publish_token",
      },
      value: "first-token",
      allowedSteps: ["publish"],
      targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      credentialClass: "routine",
      refreshMode: "renew",
      expiresAt: new Date(nowMs + 1_000).toISOString(),
    })),
    requirements: [deploymentRequirementFixture({ name: "publish_token", step: "publish" })],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    now: () => new Date(nowMs),
  });

  await runtime.enterStep("publish");
  nowMs += 2_000;

  await assert.rejects(
    async () => await runtime.enterStep("publish"),
    /expired, was revoked, or cannot be refreshed/,
  );
});

test("secret runtime keeps break-glass credentials out of the routine path", async () => {
  const requirement = deploymentRequirementFixture({ name: "publish_token", step: "publish" });
  const backend = backendFor(async () => ({
    binding: {
      name: "publish_token",
      step: "publish",
      contractId: "secret://publish_token",
      required: true,
      backend: "vault",
      referenceId: "vault:secret://publish_token",
    },
    value: "emergency-token",
    allowedSteps: ["publish"],
    targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
    credentialClass: "break_glass",
    refreshMode: "none",
  }));

  const routine = createDeploymentSecretRuntime({
    backend,
    requirements: [requirement],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });
  await assert.rejects(async () => await routine.enterStep("publish"), /break-glass path/);

  const breakGlass = createDeploymentSecretRuntime({
    authority: { kind: "break-glass-worker" },
    backend,
    requirements: [requirement],
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });
  const resolved = await breakGlass.enterStep("publish");
  assert.equal(resolved.publish_token, "emergency-token");
});
