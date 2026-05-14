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
  failureBody?: Record<string, unknown>;
};

export type FakeInfisicalSecret = {
  id?: string;
  reference?: string;
  projectId: string;
  environment: string;
  secretPath: string;
  secretName: string;
  version?: string;
  secretValue?: string;
  deleted?: boolean;
  revoked?: boolean;
  unavailable?: boolean;
  response?: Partial<FakeInfisicalSecret> & Record<string, unknown>;
  status?: number;
  errorBody?: Record<string, unknown>;
};

export type FakeInfisicalServerOptions = {
  missingProject?: boolean;
  missingEnvironment?: boolean;
  projectStatus?: number;
  environmentStatus?: number;
  machineIdentityAccess?: boolean;
  machineIdentityAccessStatus?: number;
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
      ...(auth.failureBody || {}),
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
  secrets: FakeInfisicalSecret[] = [],
  opts: FakeInfisicalServerOptions = {},
) {
  const calls: string[] = [];
  const secretCalls: string[] = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/v1/auth/universal-auth/login") {
      const body = await readBody(request);
      calls.push(String(body.clientId || ""));
      await handleUniversalAuthLoginBody(response, selectAuth(auth, body), body);
      return;
    }
    const projectMatch = url.pathname.match(/^\/api\/v1\/workspace\/([^/]+)$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1] || "");
      if (opts.projectStatus) {
        json(response, opts.projectStatus, { error: "project_access_failed" });
        return;
      }
      if (opts.missingProject || projectId !== "proj_123") {
        json(response, 404, { error: "missing_project" });
        return;
      }
      json(response, 200, { workspace: { id: projectId, name: "Deployment Project" } });
      return;
    }
    const environmentMatch = url.pathname.match(
      /^\/api\/v1\/workspace\/([^/]+)\/environments\/([^/]+)$/,
    );
    if (environmentMatch) {
      const projectId = decodeURIComponent(environmentMatch[1] || "");
      const environment = decodeURIComponent(environmentMatch[2] || "");
      if (opts.environmentStatus) {
        json(response, opts.environmentStatus, { error: "environment_access_failed" });
        return;
      }
      if (opts.missingEnvironment || projectId !== "proj_123" || environment !== "prod") {
        json(response, 404, { error: "missing_environment" });
        return;
      }
      json(response, 200, { environment: { slug: environment, name: "Production" } });
      return;
    }
    const identityAccessMatch = url.pathname.match(
      /^\/api\/v1\/workspace\/([^/]+)\/machine-identities\/([^/]+)\/project-access$/,
    );
    if (identityAccessMatch) {
      const projectId = decodeURIComponent(identityAccessMatch[1] || "");
      const identityId = decodeURIComponent(identityAccessMatch[2] || "");
      if (opts.machineIdentityAccessStatus) {
        json(response, opts.machineIdentityAccessStatus, { error: "identity_access_unavailable" });
        return;
      }
      if (projectId !== "proj_123" || identityId !== "identity_123") {
        json(response, 404, { error: "missing_identity_access" });
        return;
      }
      json(response, 200, {
        access: {
          access: opts.machineIdentityAccess !== false,
          permissions: ["secrets:read"],
          evidence: "project-membership:member",
        },
      });
      return;
    }
    const secretMatch = url.pathname.match(/^\/api\/v3\/secrets\/raw\/([^/]+)$/);
    if (secretMatch) {
      const secretName = decodeURIComponent(secretMatch[1] || "");
      const viewSecretValue = url.searchParams.get("viewSecretValue") === "true";
      secretCalls.push(
        `${secretName}:${String(viewSecretValue)}:${url.searchParams.get("secretVersion") || ""}`,
      );
      const found = secrets.find(
        (entry) =>
          entry.projectId === url.searchParams.get("workspaceId") &&
          entry.environment === url.searchParams.get("environment") &&
          entry.secretPath === url.searchParams.get("secretPath") &&
          entry.secretName === secretName &&
          (!url.searchParams.get("secretVersion") ||
            entry.version === url.searchParams.get("secretVersion")),
      );
      if (!found) {
        json(response, 404, { error: "missing_secret" });
        return;
      }
      if (found.status) {
        json(response, found.status, found.errorBody || { error: "secret_read_failed" });
        return;
      }
      const returned = { ...found, ...(found.response || {}) };
      json(response, 200, {
        secret: {
          ...returned,
          ...(viewSecretValue ? { secretValue: returned.secretValue } : {}),
          ...(!viewSecretValue ? { secretValue: undefined } : {}),
        },
      });
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
    secretCalls,
    secrets,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
