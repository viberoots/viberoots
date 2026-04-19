#!/usr/bin/env zx-wrapper
import http from "node:http";

export type FakeOidcServer = {
  issuer: string;
  close: () => Promise<void>;
  requests: string[];
};

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export async function startFakeOidcServer(opts?: {
  discoveryStatus?: number;
  tokenStatus?: number;
  omitToken?: boolean;
  claims?: Record<string, unknown>;
}): Promise<FakeOidcServer> {
  const requests: string[] = [];
  let issuer = "";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", issuer);
    requests.push(`${req.method || "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      sendJson(res, opts?.discoveryStatus || 200, {
        issuer,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
      });
      return;
    }
    if (url.pathname.endsWith("/protocol/openid-connect/token")) {
      const body = new URLSearchParams(await readBody(req));
      const claims = {
        iss: issuer,
        aud: "deployments-vault",
        azp: body.get("client_id"),
        deployment_environment: "mini",
        repository: "kiltyj/bucknix-fresh",
        ...(opts?.claims || {}),
      };
      sendJson(
        res,
        opts?.tokenStatus || 200,
        opts?.omitToken ? {} : { access_token: fakeJwt(claims) },
      );
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake OIDC server did not bind");
  issuer = `http://127.0.0.1:${address.port}/realms/deployments`;
  return {
    issuer,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
