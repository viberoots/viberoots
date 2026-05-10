#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  runPkceLogin,
  startPkceCallbackListener,
} from "../../deployments/deployment-credential-source-pkce";
import { decodeJwtPayload } from "../../deployments/deploy-vault-jwt-claims";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";

async function waitForUrl(messages: string[]): Promise<URL> {
  for (let i = 0; i < 50; i++) {
    const match = messages.join("\n").match(/Open this deployment login URL: (https?:\/\/\S+)/);
    if (match) return new URL(match[1]);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("authorization URL was not printed");
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("free port lookup failed");
  return address.port;
}

function localCallbackUrl(messages: string[]): URL {
  const match = messages.join("\n").match(/to (http:\/\/127\.0\.0\.1:\d+\/\S+)/);
  if (!match) throw new Error("local callback URL was not printed");
  return new URL(match[1]);
}

test("PKCE login prints URL, validates callback state once, and skips browser in SSH mode", async () => {
  const server = await startFakeOidcServer({
    claims: { groups: ["deploy-submitters-pleomino-dev"] },
  });
  const messages: string[] = [];
  try {
    const login = runPkceLogin({
      issuer: server.issuer,
      clientId: "deployment-cli",
      audience: "deployments-vault",
      boundClaims: {
        deployment_environment: "mini",
        repository: "kiltyj/viberoots",
      },
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
    assert.deepEqual(claims.groups, ["deploy-submitters-pleomino-dev"]);
    assert.match(messages.join("\n"), /For SSH, forward/);
  } finally {
    await server.close();
  }
});

test("PKCE login supports a reviewed reverse-proxied public callback profile", async () => {
  const server = await startFakeOidcServer({
    claims: { groups: ["deploy-submitters-pleomino-dev"] },
  });
  const messages: string[] = [];
  const bindPort = await freePort();
  try {
    const login = runPkceLogin({
      issuer: server.issuer,
      clientId: "deployment-cli",
      audience: "deployments-vault",
      boundClaims: {
        deployment_environment: "mini",
        repository: "kiltyj/viberoots",
      },
      openBrowser: false,
      callbackProfile: {
        mode: "public_host",
        externalScheme: "https",
        externalHost: "deploy-auth.apps.kilty.io",
        externalPath: "/oidc/callback",
        bindHost: "127.0.0.1",
        bindPort,
        bindPath: "/oidc/callback",
      },
      timeoutMs: 5_000,
      prompt: (message) => messages.push(message),
    });
    const url = await waitForUrl(messages);
    const advertisedRedirectUri = new URL(url.searchParams.get("redirect_uri") || "");
    assert.equal(
      advertisedRedirectUri.toString(),
      "https://deploy-auth.apps.kilty.io/oidc/callback",
    );
    const callbackUri = localCallbackUrl(messages);
    callbackUri.searchParams.set("code", "login-code");
    callbackUri.searchParams.set("state", url.searchParams.get("state") || "");
    assert.equal((await fetch(callbackUri)).status, 200);
    await login;
    assert.equal(
      server.tokenRequests.at(-1)?.get("redirect_uri"),
      advertisedRedirectUri.toString(),
    );
    assert.match(messages.join("\n"), /reverse proxy deploy-auth\.apps\.kilty\.io/);
  } finally {
    await server.close();
  }
});

test("PKCE direct public-host profile can use an explicit reviewed external port", async () => {
  const bindPort = await freePort();
  const listener = await startPkceCallbackListener({
    state: "state",
    callbackProfile: {
      mode: "public_host",
      externalScheme: "http",
      externalHost: "127.0.0.1",
      externalPort: bindPort,
      bindHost: "127.0.0.1",
      bindPort,
    },
    timeoutMs: 5_000,
  });
  try {
    assert.equal(listener.redirectUri, `http://127.0.0.1:${bindPort}/oidc/callback`);
    const url = new URL(listener.redirectUri);
    url.searchParams.set("code", "login-code");
    url.searchParams.set("state", "state");
    assert.equal((await fetch(url)).status, 200);
    assert.equal(await listener.waitForCode, "login-code");
  } finally {
    await listener.close().catch(() => {});
  }
});

test("PKCE public callback validates profile and bind failures before login URL printing", async () => {
  const occupied = net.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("occupied port lookup failed");
  try {
    await assert.rejects(
      startPkceCallbackListener({
        state: "state",
        callbackProfile: { mode: "public_host", externalHost: "https://bad.example" },
      }),
      /external_host must be a hostname/,
    );
    await assert.rejects(
      startPkceCallbackListener({
        state: "state",
        callbackProfile: {
          mode: "public_host",
          externalScheme: "ftp",
          externalHost: "deploy.example",
          bindPort: address.port,
        },
      }),
      /external_scheme must be http or https/,
    );
    await assert.rejects(
      startPkceCallbackListener({
        state: "state",
        callbackProfile: {
          mode: "public_host",
          externalScheme: "https",
          externalHost: "deploy.example",
          bindHost: "127.0.0.1",
          bindPort: address.port,
        },
      }),
      /PKCE callback bind failed/,
    );
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
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
        repository: "kiltyj/viberoots",
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
