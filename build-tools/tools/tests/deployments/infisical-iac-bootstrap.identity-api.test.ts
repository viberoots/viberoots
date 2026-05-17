#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  ensureIdentity,
  ensureUniversalAuth,
} from "../../deployments/infisical-iac-bootstrap-identity";

test("ensureIdentity reuses an existing bootstrap identity", async () => {
  const api = fakeIdentityApi([{ identity: { id: "id_1", name: "viberoots-iac-bootstrap" } }]);
  const identity = await ensureIdentity(api as never, {
    ...DEFAULT_BOOTSTRAP_ARGS,
    organizationId: "org_1",
  });
  assert.equal(identity.id, "id_1");
  assert.equal(api.posts.length, 0);
});

test("ensureIdentity creates the bootstrap identity when missing", async () => {
  const api = fakeIdentityApi([]);
  const identity = await ensureIdentity(api as never, {
    ...DEFAULT_BOOTSTRAP_ARGS,
    organizationId: "org_1",
  });
  assert.equal(identity.id, "created_id");
  assert.equal(api.posts[0]?.endpoint, "/api/v1/identities");
  assert.equal(api.posts[0]?.body.name, "viberoots-iac-bootstrap");
});

test("ensureUniversalAuth attaches Universal Auth when missing", async () => {
  const api = {
    posts: [] as Array<{ endpoint: string; body: Record<string, unknown> }>,
    request: async (method: string, endpoint: string, body?: Record<string, unknown>) => {
      if (method === "GET") return undefined;
      api.posts.push({ endpoint, body: body ?? {} });
      return {};
    },
  };
  await ensureUniversalAuth(api as never, DEFAULT_BOOTSTRAP_ARGS, {
    id: "identity_1",
    name: "viberoots-iac-bootstrap",
  });
  assert.equal(api.posts[0]?.endpoint, "/api/v1/auth/universal-auth/identities/identity_1");
  assert.equal(api.posts[0]?.body.accessTokenTTL, DEFAULT_BOOTSTRAP_ARGS.accessTokenTtl);
});

function fakeIdentityApi(entries: unknown[]) {
  const api = {
    posts: [] as Array<{ endpoint: string; body: Record<string, string> }>,
    request: async (method: string, endpoint: string, body?: Record<string, string>) => {
      if (method === "GET") return { identities: entries };
      const post = { endpoint, body: body ?? {} };
      api.posts.push(post);
      return { identity: { id: "created_id", name: post.body.name } };
    },
  };
  return api;
}
