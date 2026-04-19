#!/usr/bin/env zx-wrapper
import http from "node:http";

type FakeVaultVersion = {
  value: string;
  deleted?: boolean;
};

export type FakeVaultSecret = {
  currentVersion: string;
  versions: Record<string, FakeVaultVersion>;
};

export type FakeVaultState = Record<string, FakeVaultSecret>;

type FakeVaultJwtAuth = {
  role: string;
  jwt: string;
  token?: string;
  status?: number;
  missingClientToken?: boolean;
};

type FakeVaultOptions = {
  token?: string;
  jwtAuth?: FakeVaultJwtAuth;
};

type NormalizedFakeVaultOptions = {
  token: string;
  jwtAuth?: FakeVaultJwtAuth;
};

function contractIdFor(requestPath: string, prefix: string): string {
  return `secret://${requestPath.slice(prefix.length).replace(/^\/+/, "")}`;
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function normalizeOptions(tokenOrOpts: string | FakeVaultOptions): NormalizedFakeVaultOptions {
  const opts = typeof tokenOrOpts === "string" ? { token: tokenOrOpts } : tokenOrOpts;
  return { token: opts.token || opts.jwtAuth?.token || "test-token", jwtAuth: opts.jwtAuth };
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function handleJwtLogin(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  auth: FakeVaultJwtAuth | undefined,
  token: string,
) {
  if (!auth) return json(response, 404, { errors: ["jwt_auth_disabled"] });
  const body = JSON.parse(await readBody(request)) as { role?: unknown; jwt?: unknown };
  const rejected = body.role !== auth.role || body.jwt !== auth.jwt || auth.status;
  if (rejected) {
    json(response, auth.status || 403, { errors: ["jwt_claims_rejected"] });
    return;
  }
  json(response, 200, { auth: auth.missingClientToken ? {} : { client_token: token } });
}

export async function startFakeVaultServer(
  state: FakeVaultState,
  tokenOrOpts: string | FakeVaultOptions = "test-token",
) {
  const opts = normalizeOptions(tokenOrOpts);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/v1/auth/jwt/login") {
      await handleJwtLogin(request, response, opts.jwtAuth, opts.token);
      return;
    }
    if (request.headers["x-vault-token"] !== opts.token) {
      json(response, 403, { errors: ["forbidden"] });
      return;
    }
    if (url.pathname.startsWith("/v1/secret/metadata/")) {
      const secret = state[contractIdFor(url.pathname, "/v1/secret/metadata/")];
      if (!secret) {
        json(response, 404, { errors: ["missing"] });
        return;
      }
      json(response, 200, { data: { current_version: Number(secret.currentVersion) } });
      return;
    }
    if (url.pathname.startsWith("/v1/secret/data/")) {
      const contractId = contractIdFor(url.pathname, "/v1/secret/data/");
      const secret = state[contractId];
      if (!secret) {
        json(response, 404, { errors: ["missing"] });
        return;
      }
      const version = String(url.searchParams.get("version") || secret.currentVersion).trim();
      const selected = secret.versions[version];
      if (!selected || selected.deleted) {
        json(response, 404, { errors: ["missing_version"] });
        return;
      }
      json(response, 200, {
        data: {
          data: { value: selected.value },
          metadata: { version: Number(version) },
        },
      });
      return;
    }
    json(response, 404, { errors: ["unknown_path"] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start fake Vault server");
  }
  return {
    token: opts.token,
    addr: `http://127.0.0.1:${String(address.port)}`,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
