#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLiveVercelApiClient, VercelApiOutcomeError } from "../../deployments/vercel-api";

async function writeOutput(root: string) {
  await fsp.mkdir(path.join(root, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(path.join(root, "config.json"), '{"version":3}\n', "utf8");
  await fsp.writeFile(path.join(root, "functions", "render.func", ".vc-config.json"), "{}");
}

async function withVercelServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function publish(baseUrl: string, outputDir: string) {
  return createLiveVercelApiClient({
    apiToken: "fixture-token",
    baseUrl,
    pollAttempts: 1,
    pollIntervalMs: 0,
  }).publishPrebuilt({
    team: "web-platform",
    project: "console",
    environment: "staging",
    artifactIdentity: "vercel-next:abc",
    outputDir,
  });
}

test("live Vercel client preserves create context when polling HTTP fails", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-poll-http-fail-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        if (req.method === "GET" && req.url?.startsWith("/v13/deployments/dpl_poll_fail")) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "fixture-token", message: "try later" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(
            JSON.stringify({
              id: "dpl_poll_fail",
              readyState: "BUILDING",
              url: "poll-created.app",
            }),
          );
        } else {
          res.end("{}");
        }
      },
      async (baseUrl) => {
        await assert.rejects(
          () => publish(baseUrl, outputDir),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.outcome === "failed" &&
            error.providerReleaseId === "dpl_poll_fail" &&
            error.publicUrl === "https://poll-created.app/" &&
            !error.message.includes("fixture-token"),
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("live Vercel client preserves create URL when READY poll omits URL", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-poll-missing-url-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(
            JSON.stringify({
              id: "dpl_missing_url",
              readyState: "BUILDING",
              url: "created-before-ready.app",
            }),
          );
        } else if (req.method === "GET") {
          res.end(JSON.stringify({ id: "dpl_missing_url", readyState: "READY" }));
        } else {
          res.end("{}");
        }
      },
      async (baseUrl) => {
        await assert.rejects(
          () => publish(baseUrl, outputDir),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.outcome === "ambiguous" &&
            error.providerReleaseId === "dpl_missing_url" &&
            error.publicUrl === "https://created-before-ready.app/",
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
