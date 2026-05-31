#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  createImdsV2CredentialProvider,
  parseImdsCredentialPayload,
} from "../../deployments/control-plane-aws-imds-credentials";

async function withFakeImds(
  opts: { expired?: boolean; missingRole?: boolean; requireToken?: boolean },
  fn: (endpoint: string, seen: string[]) => Promise<void>,
) {
  const seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url || ""}`);
    if (req.url === "/latest/api/token" && req.method === "PUT") {
      res.writeHead(200).end("imds-token");
      return;
    }
    if (opts.requireToken && req.headers["x-aws-ec2-metadata-token"] !== "imds-token") {
      res.writeHead(401).end("token required");
      return;
    }
    if (req.url === "/latest/meta-data/iam/security-credentials/") {
      res.writeHead(200).end(opts.missingRole ? "" : "control-plane-role");
      return;
    }
    if (req.url === "/latest/meta-data/iam/security-credentials/control-plane-role") {
      res.writeHead(200).end(credentialPayload(opts.expired));
      return;
    }
    res.writeHead(404).end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("IMDSv2 provider requires token flow and caches unexpired credentials", async () => {
  await withFakeImds({ requireToken: true }, async (endpoint, seen) => {
    const provider = createImdsV2CredentialProvider({ endpoint });
    const first = await provider();
    const second = await provider();
    assert.equal(first.accessKeyId, "ASIAFAKEACCESS");
    assert.equal(first.sessionToken, "fake-session-token");
    assert.equal(second, first);
    assert.deepEqual(seen, [
      "PUT /latest/api/token",
      "GET /latest/meta-data/iam/security-credentials/",
      "GET /latest/meta-data/iam/security-credentials/control-plane-role",
    ]);
  });
});

test("IMDSv2 provider fails closed for missing role, expired credentials, and outages", async () => {
  await withFakeImds({ missingRole: true }, async (endpoint) => {
    await assert.rejects(() => createImdsV2CredentialProvider({ endpoint })(), /role name/);
  });
  assert.throws(
    () => parseImdsCredentialPayload(credentialPayload(true), "role"),
    /expired credentials/,
  );
  await assert.rejects(
    () => createImdsV2CredentialProvider({ endpoint: "http://127.0.0.1:1" })(),
    /fetch failed|ECONNREFUSED/,
  );
});

function credentialPayload(expired = false): string {
  return JSON.stringify({
    Code: "Success",
    AccessKeyId: "ASIAFAKEACCESS",
    SecretAccessKey: "fake-secret-key",
    Token: "fake-session-token",
    Expiration: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(),
  });
}
