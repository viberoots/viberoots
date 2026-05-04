#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { smokeCloudflarePagesStaticWebapp } from "../../deployments/cloudflare-pages-static-smoke";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";

test("cloudflare-pages custom domain smoke explains Cloudflare 522 routing failures", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cloudflare-pages-smoke-"));
  const indexPath = path.join(tmp, "index.html");
  await fsp.writeFile(indexPath, "<html>ready</html>\n", "utf8");
  const server = http.createServer((_req, res) => {
    res.writeHead(522, { "content-type": "text/plain" });
    res.end("cloudflare origin connection timeout");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("smoke fixture did not bind");
  try {
    const base = cloudflarePagesDeploymentFixture().providerTarget;
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...base,
        customDomain: "staging.pleomino.com",
        canonicalUrl: "https://staging.pleomino.com/",
      },
    });
    await assert.rejects(
      () =>
        smokeCloudflarePagesStaticWebapp({
          deployment,
          indexPath,
          connectOverride: {
            protocol: "http:",
            hostname: "127.0.0.1",
            port: address.port,
          },
        }),
      /Cloudflare returned 522 for custom domain staging\.pleomino\.com/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("cloudflare-pages custom domain smoke checks exact bytes on published Pages URL", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cloudflare-pages-smoke-published-"));
  const indexPath = path.join(tmp, "index.html");
  await fsp.writeFile(indexPath, "<html>new deployment</html>\n", "utf8");
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      host === "pleomino-staging-pages.pages.dev"
        ? "<html>new deployment</html>\n"
        : "<html>previous deployment</html>\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("smoke fixture did not bind");
  try {
    const base = cloudflarePagesDeploymentFixture().providerTarget;
    const deployment = cloudflarePagesDeploymentFixture({
      providerTarget: {
        ...base,
        customDomain: "staging.pleomino.com",
        canonicalUrl: "https://staging.pleomino.com/",
      },
    });
    const result = await smokeCloudflarePagesStaticWebapp({
      deployment,
      indexPath,
      publishedPublicUrl: "https://pleomino-staging-pages.pages.dev/",
      connectOverride: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: address.port,
      },
    });
    assert.equal(result.publicUrl, "https://staging.pleomino.com/");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
