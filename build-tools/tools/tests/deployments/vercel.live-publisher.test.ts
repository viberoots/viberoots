#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { submitVercelDeploy, submitVercelPreviewCleanup } from "../../deployments/vercel-deploy";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { admitVercelPrebuiltArtifact } from "../../deployments/vercel-artifacts";
import { publishVercelPrebuilt } from "../../deployments/vercel-publisher";
import { vercelDeploymentFixture } from "./vercel.fixture";

async function writeArtifact(root: string) {
  const output = path.join(root, ".vercel", "output");
  await fsp.mkdir(path.join(output, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(path.join(output, "config.json"), '{"version":3}\n', "utf8");
  await fsp.writeFile(
    path.join(output, "functions", "render.func", ".vc-config.json"),
    "{}",
    "utf8",
  );
  return root;
}

async function withServer(fn: (port: number) => Promise<void>) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/login" ? "authkit route" : "<html data-base='https://web.test'>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn((server.address() as any).port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withApiServer(fn: (baseUrl: string, urls: string[]) => Promise<void>) {
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    urls.push(`${req.method || ""} ${req.url || ""}`);
    if (req.method === "POST" && req.url?.startsWith("/v2/files")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "dpl_live", readyState: "READY", url: "live.vercel.app" }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/aliases")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}`, urls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("protected/shared Vercel publisher selects the live API client from provider config", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-live-select-"));
  try {
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "console-staging"), {
      recursive: true,
    });
    const artifact = await admitVercelPrebuiltArtifact(await writeArtifact(path.join(tmp, "a")));
    await withApiServer(async (baseUrl, urls) => {
      await fsp.writeFile(
        path.join(tmp, "projects", "deployments", "console-staging", "vercel-prebuilt.jsonc"),
        JSON.stringify({ mode: "prebuilt", api: { baseUrl, pollIntervalMs: 0 } }) + "\n",
      );
      const result = await publishVercelPrebuilt({
        workspaceRoot: tmp,
        recordsRoot: path.join(tmp, "records"),
        runId: "run-live-select",
        deployment: vercelDeploymentFixture(),
        artifact,
        apiToken: "fixture-token",
      });
      assert.equal(result.providerReleaseId, "dpl_live");
      assert.equal(result.aliasAssigned, true);
      assert.ok(urls.some((url) => url.startsWith("POST /v2/files")));
      assert.ok(urls.some((url) => url.startsWith("POST /v13/deployments")));
      assert.ok(urls.some((url) => url.includes("/aliases")));
    });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("Vercel deploy uses secret-runtime token, fake API, smoke, and exact artifact records", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-live-"));
  const previousFixture = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  try {
    const fixturePath = path.join(tmp, "secrets.json");
    await fsp.writeFile(
      fixturePath,
      JSON.stringify({
        schemaVersion: "deployment-secret-fixture@1",
        contracts: {
          "vercel/api-token": {
            value: "fixture-token",
            allowedSteps: ["publish", "smoke", "preview_cleanup"],
            targetScopes: ["*"],
          },
        },
      }),
    );
    process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
    const deployment = vercelDeploymentFixture({
      protectionClass: "local_only",
      secretRequirements: [
        {
          name: "vercel_api_token",
          step: "publish",
          contractId: "vercel/api-token",
          required: true,
        },
      ],
    });
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "console-staging"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmp, "projects", "deployments", "console-staging", "vercel-prebuilt.jsonc"),
      '{"mode":"prebuilt"}\n',
    );
    await withServer(async (port) => {
      const result = await submitVercelDeploy({
        workspaceRoot: tmp,
        deployment,
        recordsRoot: path.join(tmp, "records"),
        artifactDir: await writeArtifact(path.join(tmp, "artifact")),
        smokeConnectOverride: { protocol: "http:", hostname: "127.0.0.1", port },
      });
      assert.equal(result.record.finalOutcome, "succeeded");
      assert.equal(result.record.artifact?.identity.startsWith("vercel-next:"), true);
      assert.equal(result.record.smokeOutcome, "passed");
      assert.match(result.record.providerReleaseId || "", /^dpl_/);
      assert.equal(JSON.stringify(result.record).includes("fixture-token"), false);
    });
  } finally {
    if (previousFixture === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previousFixture;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("Vercel preview cleanup is audited and uses preview_cleanup secret step", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-cleanup-"));
  const previousFixture = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  try {
    const fixturePath = path.join(tmp, "secrets.json");
    await fsp.writeFile(
      fixturePath,
      JSON.stringify({
        schemaVersion: "deployment-secret-fixture@1",
        contracts: {
          "vercel/api-token": {
            value: "cleanup-token",
            allowedSteps: ["preview_cleanup"],
            targetScopes: ["*"],
          },
        },
      }),
    );
    process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
    const result = await submitVercelPreviewCleanup({
      deployment: vercelDeploymentFixture({
        protectionClass: "local_only",
        secretRequirements: [
          {
            name: "vercel_api_token",
            step: "preview_cleanup",
            contractId: "vercel/api-token",
            required: true,
          },
        ],
      }),
      recordsRoot: path.join(tmp, "records"),
      sourceRunId: "deploy-run-preview-123",
    });
    assert.equal(result.record.operationKind, "preview_cleanup");
    assert.equal(result.record.sourceRunId, "deploy-run-preview-123");
    assert.equal(JSON.stringify(result.record).includes("cleanup-token"), false);
  } finally {
    if (previousFixture === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previousFixture;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
