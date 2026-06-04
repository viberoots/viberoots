#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { SprinkleRefInfisicalStore } from "../../deployments/sprinkleref-infisical";
import { SprinkleRefLocalFileStore } from "../../deployments/sprinkleref-local-file";
import { startFakeInfisicalServer } from "./infisical.test-server";

const auth = {
  clientId: "client-id",
  clientSecret: "client-secret",
  accessToken: "access-token",
};

const env: NodeJS.ProcessEnv = {
  INFISICAL_CLIENT_ID: "client-id",
  INFISICAL_CLIENT_SECRET: "client-secret",
};

test("Infisical SprinkleRef storage derives folder path and key from logical refs", async () => {
  const server = await startFakeInfisicalServer(auth);
  try {
    const store = storeFor(server.siteUrl);
    const ref = "secret://control-plane/supabase/management-api-token";
    await store.add(ref, "one");
    assert.deepEqual(server.secrets[0], {
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/control-plane/supabase",
      secretName: "management-api-token",
      secretValue: "one",
      secretMetadata: { sprinkleref: ref },
      version: "v-written",
    });
    assert.equal(await store.read(ref), "one");
    assert.equal(await store.has(ref), true);
    await store.update(ref, "two");
    assert.equal(server.secrets[0]?.secretValue, "two");
    assert.deepEqual(server.secrets[0]?.secretMetadata, { sprinkleref: ref });
    await store.remove(ref);
    assert.equal(server.secrets.length, 0);
    assert.ok(
      server.secretCalls.every((call) => call.startsWith("management-api-token:")),
      server.secretCalls.join("\n"),
    );
  } finally {
    await server.close();
  }
});

test("Infisical SprinkleRef storage avoids collisions for matching final segments", async () => {
  const server = await startFakeInfisicalServer(auth);
  try {
    const store = storeFor(server.siteUrl);
    await store.add("secret://one/team/shared-token", "one");
    await store.add("secret://two/team/shared-token", "two");
    assert.deepEqual(
      server.secrets.map((secret) => [secret.secretPath, secret.secretName, secret.secretValue]),
      [
        ["/one/team", "shared-token", "one"],
        ["/two/team", "shared-token", "two"],
      ],
    );
  } finally {
    await server.close();
  }
});

test("non-Infisical SprinkleRef stores keep logical refs as their storage key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-local-storage-"));
  const file = path.join(dir, "values.json");
  const store = new SprinkleRefLocalFileStore(file);
  const ref = "secret://control-plane/supabase/management-api-token";
  await store.add(ref, "token");
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { [ref]: "token" });
});

test("tracked control SprinkleRef profile uses prod Infisical environment", async () => {
  for (const relPath of [
    "config/sprinkleref/selected.json",
    "config/sprinkleref/selected.local.json",
  ]) {
    const config = JSON.parse(await fs.readFile(relPath, "utf8"));
    assert.equal(config.categories.control.profile, "infisical-control");
    assert.equal(config.profiles["infisical-control"].defaultEnvironment, "prod");
  }
});

function storeFor(host: string) {
  return new SprinkleRefInfisicalStore(
    {
      backend: "infisical",
      host,
      projectId: "proj_123",
      defaultEnvironment: "prod",
      defaultPath: "/",
      clientIdEnv: "INFISICAL_CLIENT_ID",
      clientSecretEnv: "INFISICAL_CLIENT_SECRET",
    },
    env,
    fetch,
  );
}
