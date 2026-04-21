#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runPkceLogin } from "../../deployments/deployment-credential-source-pkce.ts";
import { decodeJwtPayload } from "../../deployments/deploy-vault-jwt-claims.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";

async function waitForUrl(messages: string[]): Promise<URL> {
  for (let i = 0; i < 50; i++) {
    const match = messages.join("\n").match(/http:\/\/127\.0\.0\.1:\d+\/[^\s]+/);
    if (match) return new URL(match[0]);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("authorization URL was not printed");
}

test("PKCE login prints URL, validates callback state once, and skips browser in SSH mode", async () => {
  const server = await startFakeOidcServer({ claims: { groups: ["deployers"] } });
  const messages: string[] = [];
  try {
    const login = runPkceLogin({
      issuer: server.issuer,
      clientId: "deployment-cli",
      audience: "deployments-vault",
      boundClaims: {
        deployment_environment: "mini",
        repository: "kiltyj/bucknix-fresh",
      },
      humanClaim: { name: "groups", value: "deployers" },
      openBrowser: false,
      timeoutMs: 5_000,
      prompt: (message) => messages.push(message),
    });
    const url = await waitForUrl(messages);
    const redirectUri = new URL(url.searchParams.get("redirect_uri") || "");
    redirectUri.searchParams.set("code", "login-code");
    redirectUri.searchParams.set("state", url.searchParams.get("state") || "");
    const callback = await fetch(redirectUri);
    assert.equal(callback.status, 200);
    const token = await login;
    const claims = decodeJwtPayload(token);
    assert.equal(claims.azp, "deployment-cli");
    assert.deepEqual(claims.groups, ["deployers"]);
    assert.match(messages.join("\n"), /For SSH, forward/);
  } finally {
    await server.close();
  }
});

test("PKCE callback rejects state mismatch without leaking the code", async () => {
  const server = await startFakeOidcServer();
  const messages: string[] = [];
  try {
    const login = runPkceLogin({
      issuer: server.issuer,
      clientId: "deployment-cli",
      audience: "deployments-vault",
      boundClaims: {
        deployment_environment: "mini",
        repository: "kiltyj/bucknix-fresh",
      },
      openBrowser: false,
      timeoutMs: 5_000,
      prompt: (message) => messages.push(message),
    });
    const url = await waitForUrl(messages);
    const loginFailure = assert.rejects(login, /state mismatch or missing code/);
    const redirectUri = new URL(url.searchParams.get("redirect_uri") || "");
    redirectUri.searchParams.set("code", "sensitive-code");
    redirectUri.searchParams.set("state", "wrong-state");
    assert.equal((await fetch(redirectUri)).status, 400);
    await loginFailure;
  } finally {
    await server.close();
  }
});
