#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { ensureBootstrapCredential } from "../../deployments/infisical-iac-bootstrap-identity";
import { LocalFileCredentialSink } from "../../deployments/infisical-iac-bootstrap-sink";

const identity = { id: "id_1", name: "viberoots-iac-bootstrap" };
const clientIdRef = "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id";
const ref = "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret";

test("local sink preserves existing bootstrap credential when remote record exists", async () => {
  const file = await credentialFile({ [ref]: "old-secret" });
  const api = countingCredentialApi({ remoteSecrets: [{}], clientSecret: "new-secret" });
  const credential = await ensureBootstrapCredential({
    api: api as never,
    args: DEFAULT_BOOTSTRAP_ARGS,
    identity,
    sink: new LocalFileCredentialSink(file),
  });
  assert.equal(credential.clientSecret, "old-secret");
  assert.equal(api.postCount, 0);
  assert.equal((await readStore(file))[ref], "old-secret");
  assert.equal((await readStore(file))[clientIdRef], "client-id");
});

test("local sink refuses missing local bootstrap credential when remote record exists", async () => {
  const file = await credentialFile({});
  const api = countingCredentialApi({ remoteSecrets: [{}], clientSecret: "new-secret" });
  await assert.rejects(
    () =>
      ensureBootstrapCredential({
        api: api as never,
        args: DEFAULT_BOOTSTRAP_ARGS,
        identity,
        sink: new LocalFileCredentialSink(file),
      }),
    /Import the existing value or rerun with --rotate-bootstrap-credentials/,
  );
  assert.equal(api.postCount, 0);
  assert.deepEqual(await readStore(file), {});
});

test("local sink explicit rotation overwrites only when force overwrite is set", async () => {
  const file = await credentialFile({ [ref]: "old-secret" });
  const api = countingCredentialApi({ remoteSecrets: [{}], clientSecret: "new-secret" });
  const credential = await ensureBootstrapCredential({
    api: api as never,
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      rotateBootstrapCredentials: true,
      forceOverwriteLocalCredentials: true,
    },
    identity,
    sink: new LocalFileCredentialSink(file),
  });
  assert.equal(credential.clientSecret, "new-secret");
  assert.equal(api.postCount, 1);
  assert.equal((await readStore(file))[clientIdRef], "client-id");
  assert.equal((await readStore(file))[ref], "new-secret");
});

test("bootstrap credential preserve mode refuses local overwrite before remote create", async () => {
  const file = await credentialFile({ [ref]: "old-secret" });
  const api = countingCredentialApi({ remoteSecrets: [], clientSecret: "new-secret" });
  await assert.rejects(
    () =>
      ensureBootstrapCredential({
        api: api as never,
        args: DEFAULT_BOOTSTRAP_ARGS,
        identity,
        sink: new LocalFileCredentialSink(file),
      }),
    /No new remote client secret was created/,
  );
  assert.equal(api.postCount, 0);
  assert.equal((await readStore(file))[ref], "old-secret");
});

async function credentialFile(store: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-sink-"));
  const file = path.join(dir, "credentials.json");
  await fs.writeFile(file, `${JSON.stringify(store)}\n`, { mode: 0o600 });
  return file;
}

async function readStore(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, string>;
}

function countingCredentialApi(opts: { remoteSecrets: unknown[]; clientSecret?: string }) {
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
