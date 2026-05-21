#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function writeSprinkleRefConfig(config: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-infisical-"));
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`);
  return file;
}

export async function fakeRepoBootstrapFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const method = input instanceof Request ? input.method : init?.method || "GET";
  if (url.pathname === "/api/v1/organization") {
    return jsonResponse({ organizations: [{ id: "org_1", name: "viberoots" }] });
  }
  if (url.pathname === "/api/v1/projects") {
    return jsonResponse({
      projects: [{ id: "proj_repo_test", name: "viberoots-deployments", orgId: "org_1" }],
    });
  }
  if (url.pathname === "/api/v1/projects/proj_repo_test/memberships/identities/created_identity") {
    if (method === "GET") return jsonResponse({}, 404);
    return jsonResponse({ identityMembership: { id: "membership_1" } });
  }
  if (url.pathname === "/api/v1/identities") {
    if (method === "POST") {
      return jsonResponse({
        identity: { id: "created_identity", name: "viberoots-iac-bootstrap" },
      });
    }
    return jsonResponse({ identities: [] });
  }
  if (url.pathname === "/api/v1/auth/universal-auth/identities/created_identity") {
    return jsonResponse({ identityUniversalAuth: { clientId: "client-id" } });
  }
  if (url.pathname === "/api/v1/auth/universal-auth/identities/created_identity/client-secrets") {
    return jsonResponse(
      method === "POST" ? { clientSecret: "client-secret" } : { clientSecrets: [] },
    );
  }
  if (url.pathname === "/v1/sys/mounts") return jsonResponse({ "secret/": { type: "kv" } });
  return jsonResponse({ error: `unexpected fake fetch path ${url.pathname}` }, 404);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
