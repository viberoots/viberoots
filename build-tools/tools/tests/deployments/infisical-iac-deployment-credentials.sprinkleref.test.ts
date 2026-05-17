#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ensureDeploymentCredentials } from "../../deployments/infisical-iac-deployment-credentials";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { createCredentialSink } from "../../deployments/infisical-iac-bootstrap-sink";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

test("deployment credentials write only through selected SprinkleRef bootstrap category", async () => {
  const dir = await tmp();
  await withResolverConfig(dir, async () => {
    const sink = await createCredentialSink({
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref",
    });
    await ensureDeploymentCredentials({
      api: fakeDeploymentCredentialApi() as never,
      args: DEFAULT_BOOTSTRAP_ARGS,
      sink,
      metadata: reviewedMetadata,
    });
    const bootstrapStore = await readStore(path.join(dir, "bootstrap.json"));
    assertDeploymentCredentialRefs(bootstrapStore);
    await assert.rejects(() => fs.readFile(path.join(dir, "main.json"), "utf8"), /ENOENT/);
  });
});

test("deployment credentials honor non-default SprinkleRef access category", async () => {
  const dir = await tmp();
  await withResolverConfig(dir, async () => {
    const args = {
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref" as const,
      sprinkleCategory: "access-bootstrap",
    };
    const sink = await createCredentialSink(args);
    await ensureDeploymentCredentials({
      api: fakeDeploymentCredentialApi() as never,
      args,
      sink,
      metadata: reviewedMetadata,
    });
    const accessStore = await readStore(path.join(dir, "access-bootstrap.json"));
    assertDeploymentCredentialRefs(accessStore);
    await assert.rejects(() => fs.readFile(path.join(dir, "bootstrap.json"), "utf8"), /ENOENT/);
    await assert.rejects(() => fs.readFile(path.join(dir, "main.json"), "utf8"), /ENOENT/);
  });
});

function assertDeploymentCredentialRefs(store: Record<string, string>) {
  assert.equal(
    store["secret://deployments/pleomino/staging/infisical-client-id"],
    "client-id-staging",
  );
  assert.equal(
    store["secret://deployments/pleomino/staging/infisical-client-secret"],
    "new-secret-staging",
  );
  assert.equal(store["secret://deployments/pleomino/prod/infisical-client-id"], "client-id-prod");
  assert.equal(
    store["secret://deployments/pleomino/prod/infisical-client-secret"],
    "new-secret-prod",
  );
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-deployment-sprinkleref-"));
}

async function withResolverConfig(dir: string, run: () => Promise<void>) {
  const old = process.env.SPRINKLEREF_CONFIG;
  process.env.SPRINKLEREF_CONFIG = await writeResolverConfig(dir);
  try {
    await run();
  } finally {
    if (old === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = old;
  }
}

async function writeResolverConfig(dir: string) {
  const config = path.join(dir, "sprinkleref.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: {
        main: { backend: "local-file", file: path.join(dir, "main.json") },
        bootstrap: { backend: "local-file", file: path.join(dir, "bootstrap.json") },
        "access-bootstrap": {
          backend: "local-file",
          file: path.join(dir, "access-bootstrap.json"),
        },
      },
    }),
  );
  return config;
}

async function readStore(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, string>;
}

function fakeDeploymentCredentialApi() {
  return {
    request(method: string, endpoint: string) {
      const stage = endpoint.includes("staging") ? "staging" : "prod";
      if (endpoint.endsWith("/client-secrets") && method === "GET") return { clientSecrets: [] };
      if (endpoint.endsWith("/client-secrets") && method === "POST")
        return { clientSecret: `new-secret-${stage}` };
      return { identityUniversalAuth: { clientId: `client-id-${stage}` } };
    },
  };
}
