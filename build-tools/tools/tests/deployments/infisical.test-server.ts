#!/usr/bin/env zx-wrapper
import http from "node:http";

export type FakeInfisicalAuthLogin = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  expiresIn?: number;
  status?: number;
  malformed?: boolean;
  missingAccessToken?: boolean;
  echoClientSecretOnFailure?: boolean;
};

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function handleUniversalAuthLoginBody(
  response: http.ServerResponse,
  auth: FakeInfisicalAuthLogin,
  body: Record<string, unknown>,
) {
  const rejected =
    auth.status || body.clientId !== auth.clientId || body.clientSecret !== auth.clientSecret;
  if (rejected) {
    json(response, auth.status || 401, {
      error: "universal_auth_rejected",
      ...(auth.echoClientSecretOnFailure ? { clientSecret: body.clientSecret } : {}),
    });
    return;
  }
  if (auth.malformed) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{not-json");
    return;
  }
  json(response, 200, {
    ...(auth.missingAccessToken ? {} : { accessToken: auth.accessToken }),
    expiresIn: auth.expiresIn ?? 7200,
    accessTokenMaxTTL: auth.expiresIn ?? 7200,
    tokenType: "Bearer",
  });
}

function selectAuth(
  auth: FakeInfisicalAuthLogin | FakeInfisicalAuthLogin[],
  body: Record<string, unknown>,
): FakeInfisicalAuthLogin {
  if (!Array.isArray(auth)) return auth;
  return auth.find((entry) => entry.clientId === body.clientId) || auth[0];
}

export async function startFakeInfisicalServer(
  auth: FakeInfisicalAuthLogin | FakeInfisicalAuthLogin[],
) {
  const calls: string[] = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/v1/auth/universal-auth/login") {
      const body = await readBody(request);
      calls.push(String(body.clientId || ""));
      await handleUniversalAuthLoginBody(response, selectAuth(auth, body), body);
      return;
    }
    json(response, 404, { error: "unknown_path" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start fake Infisical server");
  }
  return {
    siteUrl: `http://127.0.0.1:${String(address.port)}`,
    calls,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
