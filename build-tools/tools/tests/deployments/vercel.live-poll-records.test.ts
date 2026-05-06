#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { submitVercelDeploy } from "../../deployments/vercel-deploy";
import { vercelDeploymentFixture } from "./vercel.fixture";

async function writeArtifact(root: string) {
  const output = path.join(root, ".vercel", "output");
  await fsp.mkdir(path.join(output, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(path.join(output, "config.json"), '{"version":3}\n', "utf8");
  await fsp.writeFile(path.join(output, "functions", "render.func", ".vc-config.json"), "{}");
  return root;
}

async function writeConfig(tmp: string, baseUrl: string) {
  const dir = path.join(tmp, "projects", "deployments", "console-staging");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "vercel-prebuilt.jsonc"),
    JSON.stringify({ mode: "prebuilt", api: { baseUrl, pollAttempts: 1, pollIntervalMs: 0 } }) +
      "\n",
  );
}

async function withSecrets(tmp: string, fn: () => Promise<void>) {
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  const fixturePath = path.join(tmp, "secrets.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({
      schemaVersion: "deployment-secret-fixture@1",
      contracts: {
        "vercel/api-token": {
          value: "live-secret",
          allowedSteps: ["publish", "smoke"],
          targetScopes: ["*"],
        },
      },
    }),
  );
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previous;
  }
}

async function withApiServer(fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/v13/deployments/dpl_poll_record")) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "live-secret", message: "try later" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
      res.end(
        JSON.stringify({
          id: "dpl_poll_record",
          readyState: "BUILDING",
          url: "record-poll.vercel.app",
        }),
      );
    } else {
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function deployment() {
  return vercelDeploymentFixture({
    secretRequirements: [
      { name: "vercel_api_token", step: "publish", contractId: "vercel/api-token", required: true },
    ],
  });
}

test("live Vercel poll HTTP failure records retain context and redact diagnostics", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-live-poll-record-"));
  try {
    await withApiServer(async (baseUrl) => {
      await writeConfig(tmp, baseUrl);
      await withSecrets(tmp, async () => {
        let thrown: any;
        try {
          await submitVercelDeploy({
            workspaceRoot: tmp,
            deployment: deployment(),
            recordsRoot: path.join(tmp, "records"),
            artifactDir: await writeArtifact(path.join(tmp, "artifact")),
          });
        } catch (error) {
          thrown = error;
        }
        assert.equal(thrown.record.finalOutcome, "publish_failed");
        assert.equal(thrown.record.providerReleaseId, "dpl_poll_record");
        assert.equal(thrown.record.publicUrl, "https://record-poll.vercel.app/");
        assert.ok(thrown.record.artifact.identity.startsWith("vercel-next:"));
        const persisted = await fsp.readFile(thrown.recordPath, "utf8");
        assert.equal(persisted.includes("live-secret"), false);
        assert.match(persisted, /redacted/);
        assert.match(persisted, /dpl_poll_record/);
        assert.match(persisted, /https:\/\/record-poll\.vercel\.app\//);
      });
    });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
