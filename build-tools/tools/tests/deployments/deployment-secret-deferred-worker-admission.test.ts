#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCloudflarePagesAdmittedSecretReferences } from "../../deployments/cloudflare-pages-admission";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import type { DeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { withWorkerDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime-worker";
import type { DeploymentSecretAdmittedReference } from "../../deployments/deployment-sprinkle-ref";
import { resolveNixosSharedHostAdmittedSecretReferences } from "../../deployments/nixos-shared-host-admission-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

const targetScope = "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages";

function cloudflareDeployment(siteUrl: string): CloudflarePagesDeployment {
  return {
    ...cloudflarePagesDeploymentFixture({ secretRequirements: [infisicalRequirement] }),
    secretBackend: "infisical",
    infisicalRuntime: { ...infisicalRuntime, siteUrl },
  };
}

function workerCloudflareDeployment(siteUrl: string): CloudflarePagesDeployment {
  return {
    ...cloudflareDeployment(siteUrl),
    infisicalRuntime: {
      ...infisicalRuntime,
      siteUrl,
      preferredCredentialSource: "machine_identity_universal_auth",
      machineIdentityClientIdEnv: "VBR_TEST_INFISICAL_CLIENT_ID",
      machineIdentityClientSecretEnv: "VBR_TEST_INFISICAL_CLIENT_SECRET",
    },
  };
}

function nixosDeployment(siteUrl: string) {
  return {
    ...nixosSharedHostDeploymentFixture({ secretRequirements: [infisicalRequirement] }),
    secretBackend: "infisical" as const,
    infisicalRuntime: { ...infisicalRuntime, siteUrl },
  };
}

function deferredContext(
  mode: "reviewed_source_ref" | "promotion_source_run" | "source_run_reuse",
) {
  return {
    source: { mode },
    targetEnvironment: { lockScope: targetScope },
    admittedSecretReferences: [],
  } as any;
}

function vaultAdmittedReference(): DeploymentSecretAdmittedReference {
  return {
    name: infisicalRequirement.name,
    step: infisicalRequirement.step,
    contractId: infisicalRequirement.contractId,
    required: infisicalRequirement.required,
    backend: "vault",
    referenceId: `vault:${infisicalRequirement.contractId}`,
    targetScope,
    backendRef: infisicalRequirement.contractId,
    selectorRef: "vault:v1:secret/deployments/sample-webapp/cloudflare_api_token",
    resolvedAt: "2026-05-13T00:00:00.000Z",
    resolvedVersion: "1",
    refreshMode: "renew",
    credentialClass: "routine",
  };
}

test("cloudflare deferred worker initial and promotion admission resolves target Infisical refs", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [infisicalSecret()],
  );
  try {
    const deployment = cloudflareDeployment(server.siteUrl);
    for (const mode of ["reviewed_source_ref", "promotion_source_run"] as const) {
      const admitted = await resolveCloudflarePagesAdmittedSecretReferences({
        deployment,
        admittedContext: deferredContext(mode),
        secretContext: infisicalTestContext(server.siteUrl),
      });
      assert.equal(admitted.length, 1);
      assert.equal(admitted[0]?.backend, "infisical");
      assert.match(admitted[0]?.referenceId || "", /^infisical:/);
    }
  } finally {
    await server.close();
  }
});

test("worker secret runtime activates server-local Infisical context only during execution", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "worker-id", clientSecret: "worker-secret", accessToken: "worker-token" },
    [infisicalSecret()],
  );
  let activatedContext: DeploymentSecretContext | undefined;
  try {
    const admitted = await withWorkerDeploymentSecretRuntime(
      {
        workspaceRoot: process.cwd(),
        deployment: workerCloudflareDeployment(server.siteUrl),
        env: {
          VBR_TEST_INFISICAL_CLIENT_ID: "worker-id",
          VBR_TEST_INFISICAL_CLIENT_SECRET: "worker-secret",
        },
      },
      async (runtime) => {
        activatedContext = runtime.secretContext;
        return await resolveCloudflarePagesAdmittedSecretReferences({
          deployment: workerCloudflareDeployment(server.siteUrl),
          admittedContext: deferredContext("reviewed_source_ref"),
        });
      },
    );
    assert.equal(admitted[0]?.backend, "infisical");
    assert.match(admitted[0]?.referenceId || "", /^infisical:/);
    assert.equal(activatedContext?.kind, "infisical");
    if (activatedContext?.kind === "infisical") {
      assert.equal(activatedContext.credential.kind, "universal_auth");
      assert.equal(activatedContext.credential.clientSecret, "");
    }
  } finally {
    await server.close();
  }
});

test("nixos shared-host deferred worker initial and promotion admission resolves target Infisical refs", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [infisicalSecret()],
  );
  try {
    const deployment = nixosDeployment(server.siteUrl);
    for (const mode of ["reviewed_source_ref", "promotion_source_run"] as const) {
      const admitted = await resolveNixosSharedHostAdmittedSecretReferences({
        deployment,
        admittedContext: deferredContext(mode),
        secretContext: infisicalTestContext(server.siteUrl),
      });
      assert.equal(admitted.length, 1);
      assert.equal(admitted[0]?.backend, "infisical");
      assert.match(admitted[0]?.referenceId || "", /^infisical:/);
    }
  } finally {
    await server.close();
  }
});

test("deferred worker source-run reuse keeps exact recorded references", async () => {
  const recorded = vaultAdmittedReference();
  const context = { ...deferredContext("source_run_reuse"), admittedSecretReferences: [recorded] };
  assert.deepEqual(
    await resolveCloudflarePagesAdmittedSecretReferences({
      deployment: cloudflareDeployment("http://127.0.0.1"),
      admittedContext: context,
    }),
    [recorded],
  );
  assert.deepEqual(
    await resolveNixosSharedHostAdmittedSecretReferences({
      deployment: nixosDeployment("http://127.0.0.1"),
      admittedContext: context,
    }),
    [recorded],
  );
});
