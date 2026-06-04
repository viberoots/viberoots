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

test("Infisical SprinkleRef storage strips config and runtime schemes", async () => {
  const server = await startFakeInfisicalServer(auth);
  try {
    const store = storeFor(server.siteUrl);
    await store.add("config://control-plane/aws/account-id", "123456789012");
    await store.add("runtime://control-plane/deploy/run-id", "run-123");
    assert.deepEqual(
      server.secrets.map((secret) => [secret.secretPath, secret.secretName, secret.secretValue]),
      [
        ["/control-plane/aws", "account-id", "123456789012"],
        ["/control-plane/deploy", "run-id", "run-123"],
      ],
    );
    assert.ok(
      server.secretCalls.every((call) => !call.includes("://")),
      server.secretCalls.join("\n"),
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
  const config = JSON.parse(
    await fs.readFile(path.join("projects", "config", "shared.json"), "utf8"),
  );
  assert.equal(config.sprinkleref.categories.control.profile, "infisical-control");
  assert.equal(config.sprinkleref.categories.control.environment, "prod");
});

test("Infisical docs keep UI keys scheme-free and document cleanup only", async () => {
  const docs = await Promise.all(
    ["docs/sprinkleref.md", "docs/local-sprinkleref.md"].map(async (name) => ({
      name,
      text: await fs.readFile(name, "utf8"),
    })),
  );
  const joined = docs.map((doc) => doc.text).join("\n");
  assert.match(joined, /one-time Infisical cleanup/i);
  assert.match(joined, /root-level key `management-api-token`/);
  assert.match(joined, /folder `\/control-plane\/supabase`[\s\S]*key `management-api-token`/);
  assert.match(joined, /does not search the old root-level location/);
  assert.match(joined, /UI key `management-api-token`/);
  for (const doc of docs) {
    assert.doesNotMatch(
      doc.text,
      /(?:Infisical UI key|UI key|key)\s+`(?:secret|config|runtime):\/\//i,
      `${doc.name} must not present full logical URIs as Infisical UI keys`,
    );
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
