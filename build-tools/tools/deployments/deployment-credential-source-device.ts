#!/usr/bin/env zx-wrapper
import { discoverOidc, postFormJson, validateOidcToken } from "./deployment-credential-source-oidc";

export type DeviceLoginOptions = {
  issuer: string;
  clientId: string;
  audience?: string | undefined;
  boundClaims: Record<string, string>;
  timeoutMs?: number | undefined;
  prompt?: (message: string) => void;
};

type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSecs: number;
};

function text(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === "string" ? String(payload[key]).trim() : "";
}

async function requestDeviceAuthorization(opts: {
  endpoint: string;
  clientId: string;
  audience?: string | undefined;
}): Promise<DeviceAuthorization> {
  const body = new URLSearchParams({ client_id: opts.clientId, scope: "openid profile email" });
  if (opts.audience) body.set("audience", opts.audience);
  const payload = await postFormJson(opts.endpoint, body);
  const verificationUri =
    text(payload, "verification_uri_complete") || text(payload, "verification_uri");
  const interval = Number(payload.interval || 5);
  const auth = {
    deviceCode: text(payload, "device_code"),
    userCode: text(payload, "user_code"),
    verificationUri,
    intervalSecs: Number.isFinite(interval) && interval > 0 ? interval : 5,
  };
  if (!auth.deviceCode || !auth.userCode || !auth.verificationUri) {
    throw new Error("OIDC device authorization response missing required fields");
  }
  return auth;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollDeviceToken(opts: {
  endpoint: string;
  clientId: string;
  deviceCode: string;
  intervalSecs: number;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + opts.timeoutMs;
  let intervalSecs = opts.intervalSecs;
  while (Date.now() < deadline) {
    const response = await fetch(opts.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: opts.clientId,
        device_code: opts.deviceCode,
      }),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (response.ok && typeof payload.access_token === "string") return payload.access_token;
    const error = text(payload, "error");
    if (error === "authorization_pending") {
      await sleep(intervalSecs * 1000);
      continue;
    }
    if (error === "slow_down") {
      intervalSecs += 5;
      await sleep(intervalSecs * 1000);
      continue;
    }
    throw new Error(`OIDC device authorization failed: ${error || response.status}`);
  }
  throw new Error("OIDC device authorization timed out before login completed");
}

export async function runDeviceLogin(opts: DeviceLoginOptions): Promise<string> {
  const discovery = await discoverOidc(opts.issuer);
  if (!discovery.deviceAuthorizationEndpoint) {
    throw new Error("OIDC issuer does not advertise device authorization");
  }
  const auth = await requestDeviceAuthorization({
    endpoint: discovery.deviceAuthorizationEndpoint,
    clientId: opts.clientId,
    audience: opts.audience,
  });
  opts.prompt?.(`Open ${auth.verificationUri} and enter code ${auth.userCode}`);
  const token = await pollDeviceToken({
    endpoint: discovery.tokenEndpoint,
    clientId: opts.clientId,
    deviceCode: auth.deviceCode,
    intervalSecs: auth.intervalSecs,
    timeoutMs: opts.timeoutMs || 300_000,
  });
  validateOidcToken({
    token,
    issuer: discovery.issuer,
    audience: opts.audience,
    clientId: opts.clientId,
    boundClaims: opts.boundClaims,
  });
  return token;
}
