#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { writeSprinkleRefConfig } from "./sprinkleref-test-helpers";

const ref = "secret://deployments/pleomino/prod/cloudflare-api-token";

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

test("sprinkleref reads Infisical Universal Auth credentials from bootstrap refs", async () => {
  const server = await startFakeInfisicalServer({
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-infisical-refs-"));
  try {
    const bootstrapFile = path.join(dir, "bootstrap.json");
    await fs.writeFile(
      bootstrapFile,
      JSON.stringify({
        "secret://bootstrap/client-id": "client-id",
        "secret://bootstrap/client-secret": "client-secret",
      }),
    );
    const configPath = await writeSprinkleRefConfig({
      defaultCategory: "main",
      categories: {
        bootstrap: { backend: "local-file", file: bootstrapFile },
        main: {
          backend: "infisical",
          host: server.siteUrl,
          projectId: "proj_123",
          defaultEnvironment: "prod",
          defaultPath: "/",
          clientIdRef: "secret://bootstrap/client-id",
          clientSecretRef: "secret://bootstrap/client-secret",
        },
      },
    });
    await runSprinkleRefCli({
      argv: ["--config", configPath, "--add", ref, "--value-env", "TOKEN"],
      env: { TOKEN: "one", SPRINKLEREF_CONFIG: configPath },
      fetchImpl: fetch,
      stdout: () => undefined,
    });
    assert.equal(server.secrets[0]?.secretValue, "one");
  } finally {
    await server.close();
  }
});

test("sprinkleref bootstrap category rejects Infisical backend for write and check paths", async () => {
  await assertBootstrapRejected(bootstrapInfisicalBackendConfig(), /Infisical backend/);
});

test("sprinkleref bootstrap category rejects Infisical profile for write and check paths", async () => {
  await assertBootstrapRejected(bootstrapInfisicalProfileConfig(), /Infisical profile/);
});

test("sprinkleref bootstrap category allows local-file write and check paths", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-bootstrap-allow-"));
  const ref = "secret://deployments/pleomino/prod/infisical-client-secret";
  const store = path.join(dir, "bootstrap.json");
  const configPath = await writeSprinkleRefConfig({
    defaultCategory: "bootstrap",
    categories: { bootstrap: { backend: "local-file", file: store } },
  });
  await gitRepoWithRef(dir, ref);
  await runSprinkleRefCli({
    argv: ["--config", configPath, "--add", ref, "--category", "bootstrap", "--value-env", "TOKEN"],
    env: { TOKEN: "one" },
    stdout: () => undefined,
  });
  assert.match(await fs.readFile(store, "utf8"), /one/);
  await runSprinkleRefCli({
    argv: [
      "--config",
      configPath,
      "--update",
      ref,
      "--category",
      "bootstrap",
      "--value-env",
      "TOKEN",
    ],
    env: { TOKEN: "two" },
    stdout: () => undefined,
  });
  assert.match(await fs.readFile(store, "utf8"), /two/);
  const output: string[] = [];
  const previousExitCode = process.exitCode;
  try {
    await withCwd(dir, () =>
      runSprinkleRefCli({
        argv: ["--config", configPath, "--check", "--category", "bootstrap", "--format", "json"],
        stdout: (text) => output.push(text),
      }),
    );
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = previousExitCode;
  }
  assert.equal(JSON.parse(output.join("\n")).summary.present, 1);
  await runSprinkleRefCli({
    argv: ["--config", configPath, "--remove", ref, "--category", "bootstrap", "--yes"],
    stdout: () => undefined,
  });
  assert.doesNotMatch(await fs.readFile(store, "utf8"), /infisical-client-secret/);
});

async function assertBootstrapRejected(config: unknown, pattern: RegExp) {
  const configPath = await writeSprinkleRefConfig(config);
  const ref = "secret://deployments/pleomino/prod/infisical-client-secret";
  for (const argv of [
    ["--config", configPath, "--add", ref, "--category", "bootstrap", "--value-env", "TOKEN"],
    ["--config", configPath, "--update", ref, "--category", "bootstrap", "--value-env", "TOKEN"],
    ["--config", configPath, "--remove", ref, "--category", "bootstrap", "--yes"],
  ]) {
    await assert.rejects(
      () =>
        runSprinkleRefCli({
          argv,
          env: { TOKEN: "secret", INFISICAL_CLIENT_ID: "id", INFISICAL_CLIENT_SECRET: "secret" },
          stdout: () => undefined,
        }),
      pattern,
    );
  }
  const output: string[] = [];
  const previousExitCode = process.exitCode;
  try {
    await runSprinkleRefCli({
      argv: ["--config", configPath, "--check", "--category", "bootstrap", "--format", "json"],
      stdout: (text) => output.push(text),
    });
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
  assert.match(output.join("\n"), pattern);
}

async function gitRepoWithRef(dir: string, ref: string) {
  await fs.writeFile(path.join(dir, "contracts.txt"), `${ref}\n`);
  await $({ cwd: dir })`git init`.quiet();
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  await $({
    cwd: dir,
  })`git -c user.email=test@example.com -c user.name=Test commit -m init`.quiet();
}

async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(cwd);
  }
}

function bootstrapInfisicalBackendConfig() {
  return {
    defaultCategory: "bootstrap",
    categories: {
      bootstrap: {
        backend: "infisical",
        host: "https://app.infisical.com",
        projectId: "proj_123",
        defaultEnvironment: "prod",
        defaultPath: "/",
        clientIdEnv: "INFISICAL_CLIENT_ID",
        clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      },
    },
  };
}

function bootstrapInfisicalProfileConfig() {
  return {
    defaultCategory: "bootstrap",
    profiles: {
      "infisical-default": bootstrapInfisicalBackendConfig().categories.bootstrap,
    },
    categories: { bootstrap: { profile: "infisical-default" } },
  };
}
