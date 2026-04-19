#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mintDeployVaultJwt, runDeployVaultJwtCli } from "../../deployments/deploy-vault-jwt.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";

async function rejectsWith(serverOpts: Parameters<typeof startFakeOidcServer>[0], message: RegExp) {
  const server = await startFakeOidcServer(serverOpts);
  try {
    await assert.rejects(
      mintDeployVaultJwt({
        issuer: server.issuer,
        clientId: "deployment-runner",
        clientSecret: "secret",
        audience: "deployments-vault",
        boundClaims: { deployment_environment: "mini" },
      }),
      message,
    );
  } finally {
    await server.close();
  }
}

test("deploy-vault-jwt fails closed for missing secret env vars and unsafe outputs", async () => {
  await assert.rejects(
    runDeployVaultJwtCli(
      [
        "--issuer",
        "http://127.0.0.1:1/realms/deployments",
        "--client-id",
        "deployment-runner",
        "--client-secret-env",
        "MISSING_SECRET",
        "--out",
        "/tmp/workload.jwt",
      ],
      {},
    ),
    /client secret environment variable is unset/,
  );

  const server = await startFakeOidcServer();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "deploy-vault-jwt-dir-"));
  try {
    await assert.rejects(
      mintDeployVaultJwt({
        issuer: server.issuer,
        clientId: "deployment-runner",
        clientSecret: "secret",
        out: dir,
      }),
      /non-regular file/,
    );
  } finally {
    await server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("deploy-vault-jwt fails closed for OIDC and token response errors", async () => {
  await rejectsWith({ discoveryStatus: 500 }, /request failed/);
  await rejectsWith({ tokenStatus: 503 }, /token endpoint returned 503/);
  await rejectsWith({ omitToken: true }, /missing access_token/);
});

test("deploy-vault-jwt fails closed for expected claim mismatches", async () => {
  await rejectsWith({ claims: { iss: "wrong" } }, /issuer mismatch/);
  await rejectsWith({ claims: { aud: "wrong" } }, /audience mismatch/);
  await rejectsWith({ claims: { azp: "other" } }, /azp claim mismatch/);
  await rejectsWith({ claims: { deployment_environment: "other" } }, /bound claim mismatch/);
});
