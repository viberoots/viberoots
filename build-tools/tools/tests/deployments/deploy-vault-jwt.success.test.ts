#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mintDeployVaultJwt, runDeployVaultJwtCli } from "../../deployments/deploy-vault-jwt";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";

test("deploy-vault-jwt mints through discovery and writes a restricted token file", async () => {
  const server = await startFakeOidcServer();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deploy-vault-jwt-"));
  try {
    const out = path.join(tmp, "workload.jwt");
    const result = await mintDeployVaultJwt({
      issuer: server.issuer,
      clientId: "deployment-runner",
      clientSecret: "super-secret",
      out,
      audience: "deployments-vault",
      boundClaims: {
        deployment_environment: "mini",
        repository: "kiltyj/viberoots",
      },
    });
    assert.equal((await fsp.readFile(out, "utf8")).trim(), result.token);
    assert.equal((await fsp.stat(out)).mode & 0o777, 0o600);
    assert.deepEqual(server.requests, [
      "GET /realms/deployments/.well-known/openid-configuration",
      "POST /realms/deployments/protocol/openid-connect/token",
    ]);
  } finally {
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deploy-vault-jwt inspect mode prints claims without leaking the client secret", async () => {
  const server = await startFakeOidcServer();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deploy-vault-jwt-cli-"));
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (value?: unknown) => logs.push(String(value ?? ""));
  try {
    await runDeployVaultJwtCli(
      [
        "--issuer",
        server.issuer,
        "--client-id",
        "deployment-runner",
        "--client-secret-env",
        "TEST_CLIENT_SECRET",
        "--out",
        path.join(tmp, "workload.jwt"),
        "--audience",
        "deployments-vault",
        "--expect-claim",
        "deployment_environment=mini",
        "--print-claims",
      ],
      { TEST_CLIENT_SECRET: "super-secret" },
    );
    const printed = logs.join("\n");
    assert.match(printed, /"deployment_environment": "mini"/);
    assert.doesNotMatch(printed, /super-secret/);
  } finally {
    console.log = originalLog;
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
