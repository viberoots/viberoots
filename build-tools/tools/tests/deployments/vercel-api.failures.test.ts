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

test("live Vercel client reports HTTP provider failures with redacted diagnostics", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-http-fail-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (_req, res) => {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "fixture-token", message: "denied" }));
      },
      async (baseUrl) => {
        await assert.rejects(
          () =>
            createLiveVercelApiClient({ apiToken: "fixture-token", baseUrl }).publishPrebuilt({
              team: "web-platform",
              project: "console",
              environment: "staging",
              artifactIdentity: "vercel-next:abc",
              outputDir,
            }),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.outcome === "failed" &&
            !error.message.includes("fixture-token"),
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("live Vercel client reports ambiguous create responses with available URL", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-ambiguous-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(JSON.stringify({ readyState: "READY", url: "created.vercel.app" }));
        } else {
          res.end("{}");
        }
      },
      async (baseUrl) => {
        await assert.rejects(
          () =>
            createLiveVercelApiClient({ apiToken: "fixture-token", baseUrl }).publishPrebuilt({
              team: "web-platform",
              project: "console",
              environment: "staging",
              artifactIdentity: "vercel-next:abc",
              outputDir,
            }),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.outcome === "ambiguous" &&
            error.publicUrl === "https://created.vercel.app/",
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("live Vercel client preserves provider id and URL when alias assignment fails", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-alias-fail-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        if (req.method === "POST" && req.url?.includes("/aliases")) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "alias conflict" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(
            JSON.stringify({ id: "dpl_alias", readyState: "READY", url: "alias.vercel.app" }),
          );
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
              pollIntervalMs: 0,
            }).publishPrebuilt({
              team: "web-platform",
              project: "console",
              environment: "production",
              artifactIdentity: "vercel-next:abc",
              outputDir,
              aliases: ["console.example.com"],
            }),
          (error: any) =>
            error instanceof VercelApiOutcomeError &&
            error.providerReleaseId === "dpl_alias" &&
            error.publicUrl === "https://alias.vercel.app/",
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("live Vercel client preserves last public URL on pending poll timeout", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-api-pending-url-"));
  try {
    const outputDir = path.join(tmp, ".vercel", "output");
    await writeOutput(outputDir);
    await withVercelServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST" && req.url?.startsWith("/v13/deployments")) {
          res.end(JSON.stringify({ id: "dpl_pending", status: "BUILDING", url: "pending.app" }));
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
            error.providerReleaseId === "dpl_pending" &&
            error.publicUrl === "https://pending.app/",
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
