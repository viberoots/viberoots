#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateMiniLiveControlPlane } from "../../deployments/control-plane-mini-live-validation";
import { runInTemp } from "../lib/test-helpers";

const credentialNames = [
  "control-plane-database-url",
  "control-plane-token",
  "reviewed-source-ssh-key",
  "artifact-store-endpoint",
  "artifact-store-access-key-id",
  "artifact-store-secret-access-key",
];

async function writeCredentials(root: string, mode = 0o400) {
  await fsp.mkdir(root, { recursive: true });
  for (const name of credentialNames) {
    const file = path.join(root, name);
    await fsp.writeFile(file, `${name}\n`, "utf8");
    await fsp.chmod(file, mode);
  }
}

function fakeFetch(workers: unknown[]) {
  return (async (url: URL | string) => {
    const pathname = new URL(String(url)).pathname;
    const body = pathname === "/healthz" ? { ok: true } : { workers };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("mini live validator checks health, worker heartbeat, and credential permissions", async () => {
  await runInTemp("control-plane-mini-live-validation", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    await writeCredentials(credentials);
    const result = await validateMiniLiveControlPlane({
      baseUrl: "http://mini.example.test",
      credentialDirectory: credentials,
      credentialNames,
      fetchImpl: fakeFetch([{ workerId: "worker-1", status: "running" }]),
    });
    assert.deepEqual(result, { ok: true, workerCount: 1, credentialCount: 6 });
    await fsp.chmod(path.join(credentials, "control-plane-token"), 0o444);
    await assert.rejects(
      validateMiniLiveControlPlane({
        baseUrl: "http://mini.example.test",
        credentialDirectory: credentials,
        credentialNames,
        fetchImpl: fakeFetch([{ workerId: "worker-1", status: "running" }]),
      }),
      /group\/world readable/,
    );
    await assert.rejects(
      validateMiniLiveControlPlane({
        baseUrl: "http://mini.example.test",
        credentialDirectory: credentials,
        credentialNames,
        fetchImpl: fakeFetch([{ workerId: "worker-1", status: "stopped" }]),
      }),
      /worker worker-1 is not running/,
    );
  });
});

test("live mini validation is skipped by default without operator env", async (t) => {
  if (process.env.VBR_CONTROL_PLANE_LIVE_MINI_VALIDATION !== "1") {
    t.skip("live mini validation disabled");
    return;
  }
  const tokenFile = String(process.env.VBR_CONTROL_PLANE_LIVE_MINI_TOKEN_FILE || "").trim();
  const token = tokenFile ? (await fsp.readFile(tokenFile, "utf8")).trim() : undefined;
  await validateMiniLiveControlPlane({
    baseUrl: String(process.env.VBR_CONTROL_PLANE_LIVE_MINI_URL || "").trim(),
    credentialDirectory: String(
      process.env.VBR_CONTROL_PLANE_LIVE_MINI_CREDENTIAL_DIR || "",
    ).trim(),
    expectedUid: Number(process.env.VBR_CONTROL_PLANE_LIVE_MINI_CREDENTIAL_UID || "10001"),
    expectedGid: Number(process.env.VBR_CONTROL_PLANE_LIVE_MINI_CREDENTIAL_GID || "10001"),
    ...(token ? { token } : {}),
  });
});
