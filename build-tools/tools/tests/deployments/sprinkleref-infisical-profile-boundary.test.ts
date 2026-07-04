#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { SprinkleRefInfisicalStore } from "../../deployments/sprinkleref-infisical";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { writeSprinkleRefConfig } from "./sprinkleref-test-helpers";

const ref = "secret://deployments/sample-webapp/prod/cloudflare-api-token";

test("sprinkleref rejects Infisical tokenEnv profiles", async () => {
  const configPath = await writeSprinkleRefConfig({
    defaultCategory: "main",
    categories: {
      main: infisicalProfile({ tokenEnv: "INFISICAL_ACCESS_TOKEN" }),
    },
  });
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: ["--config", configPath, "--add", ref, "--value-env", "TOKEN"],
        env: { INFISICAL_ACCESS_TOKEN: "raw-token", TOKEN: "one" },
        fetchImpl: fetch,
        stdout: () => undefined,
      }),
    /infisical backend does not support tokenEnv[\s\S]*clientIdEnv and clientSecretEnv/,
  );
});

test("sprinkleref requires both Infisical Universal Auth env names", async () => {
  for (const [profile, pattern] of [
    [{ clientSecretEnv: "INFISICAL_CLIENT_SECRET" }, /requires clientIdEnv/],
    [{ clientIdEnv: "INFISICAL_CLIENT_ID" }, /requires clientSecretEnv/],
  ] as const) {
    const configPath = await writeSprinkleRefConfig({
      defaultCategory: "main",
      categories: { main: infisicalProfile(profile) },
    });
    await assert.rejects(
      () => runSprinkleRefCli({ argv: ["--config", configPath, "--check"] }),
      pattern,
    );
  }
});

test("Infisical SprinkleRef runtime does not accept raw token env credentials", async () => {
  const store = new SprinkleRefInfisicalStore(
    infisicalProfile({ tokenEnv: "INFISICAL_ACCESS_TOKEN" }),
    { INFISICAL_ACCESS_TOKEN: "raw-token" },
    async () => {
      throw new Error("raw token runtime must not reach Infisical");
    },
  );
  await assert.rejects(() => store.has(ref), /missing Infisical Universal Auth environment/);
});

function infisicalProfile(extra: Record<string, string>) {
  return {
    backend: "infisical" as const,
    host: "https://app.infisical.com",
    projectId: "proj_123",
    defaultEnvironment: "prod",
    ...extra,
  };
}
