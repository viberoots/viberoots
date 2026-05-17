#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { writeSprinkleRefConfig } from "./sprinkleref-test-helpers";

test("sprinkleref writes ordinary secrets to Infisical main backend through resolver", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
  });
  try {
    const env = {
      INFISICAL_CLIENT_ID: "client-id",
      INFISICAL_CLIENT_SECRET: "client-secret",
    };
    const config = {
      defaultCategory: "main",
      categories: {
        main: {
          backend: "infisical",
          host: server.siteUrl,
          projectId: "proj_123",
          defaultEnvironment: "prod",
          defaultPath: "/",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
    };
    const ref = "secret://deployments/pleomino/prod/cloudflare-api-token";
    const configPath = await writeSprinkleRefConfig(config);
    await runSprinkleRefCli({
      argv: ["--config", configPath, "--add", ref, "--value-env", "TOKEN"],
      env: { ...env, TOKEN: "one" },
      fetchImpl: fetch,
      stdout: () => undefined,
    });
    assert.equal(server.secrets[0]?.secretValue, "one");
    await runSprinkleRefCli({
      argv: ["--config", configPath, "--update", ref, "--value-env", "TOKEN"],
      env: { ...env, TOKEN: "two" },
      fetchImpl: fetch,
      stdout: () => undefined,
    });
    assert.equal(server.secrets[0]?.secretValue, "two");
    await runSprinkleRefCli({
      argv: ["--config", configPath, "--remove", ref, "--yes"],
      env,
      fetchImpl: fetch,
      stdout: () => undefined,
    });
    assert.equal(server.secrets.length, 0);
  } finally {
    await server.close();
  }
});
