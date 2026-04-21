#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import http from "node:http";
import {
  authorizationUrl,
  discoverOidc,
  exchangePkceCodeForToken,
  randomSecret,
  validateOidcToken,
  type HumanClaimRequirement,
} from "./deployment-credential-source-oidc.ts";
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
  type DeploymentPkceCallbackProfile,
  type DeploymentPkceCallbackProfileInput,
} from "./deployment-pkce-callback-profile.ts";

export type PkceLoginOptions = {
  issuer: string;
  clientId: string;
  audience?: string | undefined;
  boundClaims: Record<string, string>;
  humanClaim?: HumanClaimRequirement | undefined;
  openBrowser: boolean;
  callbackProfile?: DeploymentPkceCallbackProfileInput | undefined;
  timeoutMs?: number | undefined;
  prompt?: (message: string) => void;
};

export type PkceCallbackListener = {
  redirectUri: string;
  localCallbackUri: string;
  profile: DeploymentPkceCallbackProfile;
  waitForCode: Promise<string>;
  close: () => Promise<void>;
};

function callbackResponse(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function uriFor(opts: {
  scheme: "http" | "https";
  host: string;
  port?: number | undefined;
  path: string;
}): string {
  const port = opts.port ? `:${opts.port}` : "";
  return `${opts.scheme}://${urlHost(opts.host)}${port}${opts.path}`;
}

export async function startPkceCallbackListener(opts: {
  state: string;
  callbackProfile?: DeploymentPkceCallbackProfileInput | undefined;
  timeoutMs?: number | undefined;
}): Promise<PkceCallbackListener> {
  const profile = normalizeDeploymentPkceCallbackProfile(opts.callbackProfile);
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let resolveCode: (code: string) => void = () => {};
  let rejectCode: (error: Error) => void = () => {};
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = http.createServer(async (req, res) => {
    if (settled) return callbackResponse(res, 410, "login callback already consumed");
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== profile.bindPath) {
      callbackResponse(res, 404, "login callback path not found");
      return;
    }
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (state !== opts.state || !code) {
      callbackResponse(res, 400, "login callback rejected");
      rejectCode(new Error("OIDC login callback state mismatch or missing code"));
      await closeServer(server);
      return;
    }
    callbackResponse(res, 200, "login complete; return to the deploy command");
    resolveCode(code);
    await closeServer(server);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(new Error(`PKCE callback bind failed for ${profile.bindHost}: ${error.message}`));
    };
    server.once("error", onError);
    server.listen(profile.bindPort || 0, profile.bindHost, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PKCE callback listener failed");
  timeout = setTimeout(async () => {
    if (settled) return;
    settled = true;
    rejectCode(new Error("OIDC login timed out before callback completed"));
    await closeServer(server);
  }, opts.timeoutMs || 300_000);
  const port = profile.bindPort || address.port;
  const redirectPort = profile.externalPort || (profile.mode === "loopback" ? port : undefined);
  const redirectUri = uriFor({
    scheme: profile.externalScheme,
    host: profile.externalHost,
    port: redirectPort,
    path: profile.externalPath,
  });
  return {
    redirectUri,
    localCallbackUri: uriFor({
      scheme: "http",
      host: profile.bindHost,
      port,
      path: profile.bindPath,
    }),
    profile,
    waitForCode,
    close: async () => {
      if (timeout) clearTimeout(timeout);
      if (!settled) {
        settled = true;
        rejectCode(new Error("OIDC login callback listener closed"));
      }
      await closeServer(server);
    },
  };
}

async function launchBrowser(url: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function runPkceLogin(opts: PkceLoginOptions): Promise<string> {
  const discovery = await discoverOidc(opts.issuer);
  const state = randomSecret();
  const nonce = randomSecret();
  const verifier = randomSecret(48);
  const listener = await startPkceCallbackListener({
    state,
    callbackProfile: opts.callbackProfile,
    timeoutMs: opts.timeoutMs,
  });
  try {
    const url = authorizationUrl({
      endpoint: discovery.authorizationEndpoint,
      clientId: opts.clientId,
      redirectUri: listener.redirectUri,
      verifier,
      state,
      nonce,
      audience: opts.audience,
    });
    opts.prompt?.(`Open this deployment login URL: ${url}`);
    if (!opts.openBrowser) {
      if (listener.profile.mode === "loopback") {
        opts.prompt?.(`For SSH, forward ${listener.redirectUri} to this host and complete login.`);
      } else {
        opts.prompt?.(
          `OIDC will redirect to ${listener.redirectUri}; reverse proxy ${listener.profile.externalHost} to ${listener.localCallbackUri} while the deploy command is waiting.`,
        );
      }
    } else {
      await launchBrowser(url);
    }
    const token = await exchangePkceCodeForToken({
      tokenEndpoint: discovery.tokenEndpoint,
      clientId: opts.clientId,
      code: await listener.waitForCode,
      redirectUri: listener.redirectUri,
      verifier,
    });
    validateOidcToken({
      token,
      issuer: discovery.issuer,
      audience: opts.audience,
      clientId: opts.clientId,
      boundClaims: opts.boundClaims,
      humanClaim: opts.humanClaim,
    });
    return token;
  } finally {
    await listener.close().catch(() => {});
  }
}
