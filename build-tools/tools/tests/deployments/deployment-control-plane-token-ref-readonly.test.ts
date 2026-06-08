#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { maybeHandleReadonlyDeployCli } from "../../deployments/deploy-cli-readonly";
import type { DeployCliReadonlyFlags } from "../../deployments/deploy-cli-readonly";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const TOKEN_REF = "secret://control-plane/pleomino/staging/service-token";

test("readonly operator flow resolves selected secret token through Infisical context", async () => {
  const control = await startReadonlyControlPlaneServer();
  const infisical = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "infisical-access" },
    [infisicalSecret("readonly-operator-token")],
  );
  try {
    await withProcessEnv(
      { PLEOMINO_INFISICAL_CLIENT_ID: "id", PLEOMINO_INFISICAL_CLIENT_SECRET: "secret" },
      async () => {
        await withArgv(["--current-stage-state"], async () => {
          const handled = await captureConsoleJson(() =>
            maybeHandleReadonlyDeployCli({
              workspaceRoot: process.cwd(),
              deployment: deployment(control.url, infisical.siteUrl),
              flags: readonlyFlags({ controlPlaneOperatorAction: "current-stage-state" }),
            }),
          );
          assert.equal(handled.result, true);
          assert.equal(handled.output.deploymentId, "pleomino-staging");
          assert.doesNotMatch(
            JSON.stringify(handled.output),
            /readonly-operator-token|Bearer readonly-operator-token|clientSecret/,
          );
        });
      },
    );
    assert.deepEqual(control.authHeaders, ["Bearer readonly-operator-token"]);
  } finally {
    await infisical.close();
    await control.close();
  }
});

test("readonly vault helper status lookup gets selected secret backend context", async () => {
  const control = await startReadonlyControlPlaneServer();
  const infisical = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "infisical-access" },
    [infisicalSecret("readonly-bootstrap-token")],
  );
  try {
    await withProcessEnv(
      { PLEOMINO_INFISICAL_CLIENT_ID: "id", PLEOMINO_INFISICAL_CLIENT_SECRET: "secret" },
      async () => {
        await withArgv(["--deploy-run-id", "deploy-run-1"], async () => {
          const handled = await captureConsoleJson(() =>
            maybeHandleReadonlyDeployCli({
              workspaceRoot: process.cwd(),
              deployment: deployment(control.url, infisical.siteUrl),
              flags: readonlyFlags({ printVaultBootstrap: true }),
            }),
          );
          assert.equal(handled.result, true);
          assert.equal(handled.output.targetScope.value, "readonly-lock-scope");
          assert.doesNotMatch(
            JSON.stringify(handled.output),
            /readonly-bootstrap-token|Bearer readonly-bootstrap-token|clientSecret/,
          );
        });
      },
    );
    assert.deepEqual(control.authHeaders, ["Bearer readonly-bootstrap-token"]);
  } finally {
    await infisical.close();
    await control.close();
  }
});

function deployment(controlPlaneUrl: string, siteUrl: string) {
  const base = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-staging",
    controlPlane: {
      name: "pleomino-staging",
      serviceClient: { controlPlaneUrl, controlPlaneTokenRef: TOKEN_REF },
      records: { backend: "service" },
    },
    deploymentContext: { name: "pleomino-staging" },
    secretRequirements: cloudflarePagesApiTokenRequirements(),
  });
  return {
    ...base,
    secretBackend: "infisical" as const,
    infisicalRuntime: {
      siteUrl,
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/",
      preferredCredentialSource: "machine_identity_universal_auth" as const,
      machineIdentityClientIdEnv: "PLEOMINO_INFISICAL_CLIENT_ID",
      machineIdentityClientSecretEnv: "PLEOMINO_INFISICAL_CLIENT_SECRET",
    },
  };
}

function infisicalSecret(secretValue: string) {
  return {
    id: "sec_readonly",
    projectId: "proj_123",
    environment: "prod",
    secretPath: "/",
    secretName: "service-token",
    version: "1",
    secretValue,
  };
}

async function startReadonlyControlPlaneServer() {
  const authHeaders: string[] = [];
  const server = http.createServer((request, response) => {
    authHeaders.push(String(request.headers.authorization || ""));
    const url = new URL(request.url || "/", "http://127.0.0.1");
    response.writeHead(200, {
      connection: "close",
      "content-type": "application/json; charset=utf-8",
    });
    if (url.pathname.endsWith("/current-stage-state")) {
      response.end(
        JSON.stringify({
          deploymentId: "pleomino-staging",
          deploymentLabel: "//projects/deployments/pleomino/staging:deploy",
          environmentStage: "staging",
        }),
      );
      return;
    }
    response.end(JSON.stringify({ submissionId: "sub-1", lockScope: "readonly-lock-scope" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind mock server");
  return {
    authHeaders,
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function withArgv(args: string[], run: () => Promise<void>) {
  const oldArgv = process.argv;
  process.argv = ["node", "test", ...args];
  try {
    await run();
  } finally {
    process.argv = oldArgv;
  }
}

async function withProcessEnv(env: NodeJS.ProcessEnv, run: () => Promise<void>) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    await run();
  } finally {
    process.env = previous;
  }
}

async function captureConsoleJson<T>(run: () => Promise<T>) {
  const previous = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    const result = await run();
    return { result, output: JSON.parse(lines.join("\n")) };
  } finally {
    console.log = previous;
  }
}

function readonlyFlags(overrides: Partial<DeployCliReadonlyFlags>): DeployCliReadonlyFlags {
  return {
    printTargetIdentity: false,
    printVaultBootstrap: false,
    printVaultSecretTemplates: false,
    vaultBootstrapFormat: "json",
    vaultSecretTemplateFormat: "json",
    vaultBootstrapInputs: {},
    vaultRuntimeInputs: {},
    validateOnly: false,
    remove: false,
    provisionOnly: false,
    publishOnly: false,
    preview: false,
    previewCleanup: false,
    rollback: false,
    retireTarget: false,
    migrateTarget: false,
    targetExceptionRef: "",
    cleanupReason: "manual_cleanup",
    sourceRunId: "",
    artifactDirFlag: "",
    controlPlaneDatabaseUrl: "",
    controlPlaneUrl: "",
    controlPlaneToken: undefined,
    remote: "",
    allowControlPlaneOverride: false,
    ...overrides,
  };
}
