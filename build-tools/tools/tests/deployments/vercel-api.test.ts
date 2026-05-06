#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLiveVercelApiClient, VercelApiOutcomeError } from "../../deployments/vercel-api";

type RequestLog = { method: string; url: string; body: Buffer };

async function writeOutput(root: string) {
  await fsp.mkdir(path.join(root, "functions", "render.func"), { recursive: true });
  await fsp.writeFile(path.join(root, "config.json"), '{"version":3}\n', "utf8");
  await fsp.writeFile(path.join(root, "functions", "render.func", ".vc-config.json"), "{}");
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function withVercelServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void,
  fn: (baseUrl: string, logs: RequestLog[]) => Promise<void>,
) {
  const logs: RequestLog[] = [];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    logs.push({ method: req.method || "", url: req.url || "", body });
    handler(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}`, logs);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("live Vercel client uploads prebuilt output, creates deployment, polls, and assigns alias", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        if (req.method === "POST" && req.url?.startsWith("/v2/files")) {
          assert.equal(req.headers.authorization, "Bearer fixture-token");
          assert.match(String(req.headers["x-vercel-digest"] || ""), /^[a-f0-9]{40}$/);
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
          return;
        }
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "dpl_live", status: "BUILDING" }));
          return;
        }
        if (req.method === "GET" && req.url?.startsWith("/v13/deployments/dpl_live")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "dpl_live", readyState: "READY", url: "live.vercel.app" }));
          return;
        }
        if (req.method === "POST" && req.url?.startsWith("/v2/deployments/dpl_live/aliases")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ uid: "alias_1", alias: "console.example.com" }));
          return;
        }
        res.writeHead(404).end();
      },
      async (baseUrl, logs) => {
        const result = await createLiveVercelApiClient({
          apiToken: "fixture-token",
          baseUrl,
          pollIntervalMs: 0,
        }).publishPrebuilt({
          team: "web-platform",
          project: "console",
          environment: "production",
          artifactIdentity: "vercel-next:abc",
          outputDir,
          aliases: ["console.example.com"],
        });
        assert.deepEqual(result, {
          deploymentId: "dpl_live",
          url: "https://live.vercel.app/",
          aliasAssigned: true,
        });
        const createBody = JSON.parse(
          logs.find((entry) => entry.url.startsWith("/v13/deployments"))!.body.toString("utf8"),
        );
        assert.equal(createBody.prebuilt, true);
        assert.deepEqual(createBody.files.map((entry: any) => entry.file).sort(), [
          "config.json",
          "functions/render.func/.vc-config.json",
        ]);
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("live Vercel client reports pending provider outcomes with provider id", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-pending-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(JSON.stringify({ id: "dpl_pending", status: "BUILDING" }));
        } else if (req.method === "GET") {
          res.end(JSON.stringify({ id: "dpl_pending", readyState: "BUILDING" }));
        } else {
          res.end("{}");
        }
      },
      async (baseUrl) => {
        await assert.rejects(
          () =>
            createLiveVercelApiClient({
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
            }),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.outcome === "pending" &&
            error.providerReleaseId === "dpl_pending",
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
