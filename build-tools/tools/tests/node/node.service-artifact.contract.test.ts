#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  artifactIdentityForNodeServiceDir,
  createNodeServiceArtifact,
  loadServiceRuntimeContract,
} from "../../node/service-artifact.ts";

async function withTemp<T>(prefix: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  try {
    return await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function writeFixture(
  root: string,
): Promise<{ distDir: string; contractPath: string; packageJsonPath: string }> {
  const dist = path.join(root, "dist");
  await fsp.mkdir(dist, { recursive: true });
  await fsp.writeFile(path.join(dist, "index.js"), "console.log('ok');\n", "utf8");
  const contract = path.join(root, "service.runtime.json");
  await fsp.writeFile(
    contract,
    JSON.stringify(
      {
        schemaVersion: "node-service-runtime@1",
        serviceName: "demo-service",
        entrypoint: "index.js",
        productionCommand: ["node", "dist/index.js"],
        health: { path: "/healthz", port: 3000 },
        runtimeConfig: ["PORT"],
        secretRequirements: ["DATABASE_URL"],
      },
      null,
      2,
    ) + "\n",
  );
  const packageJson = path.join(root, "package.json");
  await fsp.writeFile(packageJson, JSON.stringify({ type: "module" }) + "\n");
  return { distDir: dist, contractPath: contract, packageJsonPath: packageJson };
}

test("node service artifacts carry runtime contract and stable byte identity", async () => {
  await withTemp("node-service-artifact-identity", async (tmp) => {
    const fixture = await writeFixture(tmp);
    const out = path.join(tmp, "artifact");
    const identityPath = path.join(out, "artifact-identity.json");
    const first = await createNodeServiceArtifact({ ...fixture, outDir: out, identityPath });
    assert.equal(first, await artifactIdentityForNodeServiceDir(out));
    await fsp.rm(out, { recursive: true, force: true });
    const second = await createNodeServiceArtifact({ ...fixture, outDir: out, identityPath });
    assert.equal(second, first);
    const contract = await loadServiceRuntimeContract(path.join(out, "runtime-contract.json"));
    assert.equal(contract.health.path, "/healthz");
  });
});

test("node service artifact validation fails closed on missing config and secrets", async () => {
  await withTemp("node-service-artifact-invalid-contract", async (tmp) => {
    const invalid = path.join(tmp, "service.runtime.json");
    await fsp.writeFile(
      invalid,
      JSON.stringify({
        schemaVersion: "node-service-runtime@1",
        serviceName: "bad",
        entrypoint: "index.js",
        productionCommand: ["node", "dist/index.js"],
        health: { path: "healthz", port: 3000 },
        runtimeConfig: ["lowercase"],
      }) + "\n",
    );
    await assert.rejects(() => loadServiceRuntimeContract(invalid), /health\.path|runtimeConfig/);
  });
});
