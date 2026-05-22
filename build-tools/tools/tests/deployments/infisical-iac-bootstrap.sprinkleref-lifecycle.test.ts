#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { ensureBootstrapCredential } from "../../deployments/infisical-iac-bootstrap-identity";
import { createCredentialSink } from "../../deployments/infisical-iac-bootstrap-sink";

const identity = { id: "id_1", name: "viberoots-iac-bootstrap" };
const clientIdRef = "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id";
const clientSecretRef = "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret";

test("SprinkleRef bootstrap category stores IaC client id and secret", async () => {
  const dir = await tmp();
  await withResolverConfig(dir, async () => {
    const sink = await createCredentialSink({
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref",
    });
    await ensureBootstrapCredential({
      api: bootstrapCredentialApi({ remoteSecrets: [], clientSecret: "new-secret" }) as never,
      args: DEFAULT_BOOTSTRAP_ARGS,
      identity,
      sink,
    });
    const bootstrapStore = await readStore(path.join(dir, "bootstrap.json"));
    assert.equal(bootstrapStore[clientIdRef], "client-id");
    assert.equal(bootstrapStore[clientSecretRef], "new-secret");
    await assert.rejects(() => fs.readFile(path.join(dir, "main.json"), "utf8"), /ENOENT/);
  });
});

test("SprinkleRef bootstrap category preserves and rotates IaC credentials", async () => {
  const dir = await tmp();
  await fs.writeFile(
    path.join(dir, "bootstrap.json"),
    JSON.stringify({ [clientSecretRef]: "old" }),
  );
  await withResolverConfig(dir, async () => {
    const sink = await createCredentialSink({
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref",
    });
    const preservedApi = bootstrapCredentialApi({ remoteSecrets: [{}], clientSecret: "new" });
    await ensureBootstrapCredential({
      api: preservedApi as never,
      args: DEFAULT_BOOTSTRAP_ARGS,
      identity,
      sink,
    });
    assert.equal(preservedApi.postCount, 0);
    const rotatedApi = bootstrapCredentialApi({ remoteSecrets: [{}], clientSecret: "rotated" });
    await ensureBootstrapCredential({
      api: rotatedApi as never,
      args: {
        ...DEFAULT_BOOTSTRAP_ARGS,
        rotateBootstrapCredentials: true,
        forceOverwriteLocalCredentials: true,
      },
      identity,
      sink,
    });
    assert.equal(rotatedApi.postCount, 1);
    assert.equal((await readStore(path.join(dir, "bootstrap.json")))[clientSecretRef], "rotated");
  });
});

test("SprinkleRef bootstrap preserve mode refuses client id overwrite even with force", async () => {
  const dir = await tmp();
  await fs.writeFile(
    path.join(dir, "bootstrap.json"),
    JSON.stringify({ [clientIdRef]: "old-client-id", [clientSecretRef]: "old" }),
  );
  await withResolverConfig(dir, async () => {
    const sink = await createCredentialSink({
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref",
    });
    const api = bootstrapCredentialApi({ remoteSecrets: [{}], clientSecret: "new" });
    await assert.rejects(
      () =>
        ensureBootstrapCredential({
          api: api as never,
          args: { ...DEFAULT_BOOTSTRAP_ARGS, forceOverwriteLocalCredentials: true },
          identity,
          sink,
        }),
      /may be replaced only when a new remote credential is created/,
    );
    assert.equal(api.postCount, 0);
    assert.equal((await readStore(path.join(dir, "bootstrap.json")))[clientIdRef], "old-client-id");
  });
});

test("SprinkleRef bootstrap reuses local credential without remote records", async () => {
  const dir = await tmp();
  await fs.writeFile(
    path.join(dir, "bootstrap.json"),
    JSON.stringify({ [clientSecretRef]: "old" }),
  );
  await withResolverConfig(dir, async () => {
    const sink = await createCredentialSink({
      ...DEFAULT_BOOTSTRAP_ARGS,
      credentialSink: "sprinkleref",
    });
    const api = bootstrapCredentialApi({ remoteSecrets: [], clientSecret: "new" });
    const credential = await ensureBootstrapCredential({
      api: api as never,
      args: { ...DEFAULT_BOOTSTRAP_ARGS, forceOverwriteLocalCredentials: true },
      identity,
      sink,
    });
    assert.equal(credential.status, "reused");
    assert.equal(api.postCount, 0);
    assert.equal((await readStore(path.join(dir, "bootstrap.json")))[clientSecretRef], "old");
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-sprinkleref-"));
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
      },
    }),
  );
  return config;
}

async function readStore(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, string>;
}

function bootstrapCredentialApi(opts: { remoteSecrets: unknown[]; clientSecret: string }) {
  return {
    postCount: 0,
    request(method: string, endpoint: string) {
      if (endpoint.endsWith("/client-secrets") && method === "GET")
        return { clientSecrets: opts.remoteSecrets };
      if (endpoint.endsWith("/client-secrets") && method === "POST") {
        this.postCount += 1;
        return { clientSecret: opts.clientSecret };
      }
      return { identityUniversalAuth: { clientId: "client-id" } };
    },
  };
}
