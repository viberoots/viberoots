#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runDeviceLogin } from "../../deployments/deployment-credential-source-device";
import { decodeJwtPayload } from "../../deployments/deploy-vault-jwt-claims";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";

function deviceLogin(issuer: string, messages: string[]) {
  return runDeviceLogin({
    issuer,
    clientId: "deployment-cli",
    audience: "deployments-vault",
    boundClaims: {
      deployment_environment: "mini",
      repository: "kiltyj/bucknix-fresh",
    },
    timeoutMs: 5_000,
    prompt: (message) => messages.push(message),
  });
}

test("device flow displays verification URI and returns validated human token", async () => {
  const server = await startFakeOidcServer({
    claims: { groups: ["deploy-submitters-pleomino-dev"] },
  });
  const messages: string[] = [];
  try {
    const token = await deviceLogin(server.issuer, messages);
    const claims = decodeJwtPayload(token);
    assert.equal(claims.azp, "deployment-cli");
    assert.deepEqual(claims.groups, ["deploy-submitters-pleomino-dev"]);
    assert.match(messages.join("\n"), /ABCD-EFGH/);
  } finally {
    await server.close();
  }
});

test("device flow fails closed on denied authorization", async () => {
  const server = await startFakeOidcServer({
    claims: { groups: ["deploy-submitters-pleomino-dev"] },
    device: { firstPollError: "access_denied" },
  });
  try {
    await assert.rejects(deviceLogin(server.issuer, []), /access_denied/);
  } finally {
    await server.close();
  }
});
