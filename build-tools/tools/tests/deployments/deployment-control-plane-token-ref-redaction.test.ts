#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { runProtectedCloudflarePagesDeployFrontDoor } from "../../deployments/cloudflare-pages-protected-front-door";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const TOKEN_REF = "secret://control-plane/pleomino/staging/service-token";

test("service submission evidence omits resolved selected control-plane token payload", async () => {
  const control = await startControlPlaneRecorder();
  const infisical = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [infisicalSecret("submission-secret-token")],
  );
  const restore = activateDeploymentSecretContext(infisicalTestContext(infisical.siteUrl));
  try {
    await runProtectedCloudflarePagesDeployFrontDoor({
      workspaceRoot: process.cwd(),
      deployment: deployment(infisical.siteUrl, control.url),
      publishOnly: true,
      preview: false,
      previewCleanup: false,
      rollback: false,
      retireTarget: false,
      migrateTarget: false,
      targetExceptionRef: "",
      sourceRunId: "",
      cleanupReason: "manual_cleanup",
      controlPlaneUrl: "",
      hasFlag: () => false,
    });
    assert.deepEqual(control.authHeaders, ["Bearer submission-secret-token"]);
    const serializedBodies = control.bodies.join("\n");
    assert.match(serializedBodies, /secret:\/\/control-plane\/pleomino\/staging\/service-token/);
    assert.match(serializedBodies, /"source":"context"/);
    assert.doesNotMatch(serializedBodies, /submission-secret-token|Bearer token|clientSecret/);
  } finally {
    restore();
    await infisical.close();
    await control.close();
  }
});

function deployment(siteUrl: string, controlPlaneUrl: string) {
  const base = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-staging",
    controlPlane: {
      name: "pleomino-staging",
      serviceClient: { controlPlaneUrl, controlPlaneTokenRef: TOKEN_REF },
      records: { backend: "service" },
    },
    deploymentContext: { name: "pleomino-staging" },
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

function infisicalSecret(secretValue: string) {
  return {
    id: "sec_submission",
    projectId: "proj_123",
    environment: "prod",
    secretPath: "/",
    secretName: "service-token",
    version: "1",
    secretValue,
  };
}

async function startControlPlaneRecorder() {
  const authHeaders: string[] = [];
  const bodies: string[] = [];
  const server = http.createServer((request, response) => {
    authHeaders.push(String(request.headers.authorization || ""));
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, {
        connection: "close",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ final: { finalOutcome: "succeeded" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind control plane");
  return {
    authHeaders,
    bodies,
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
