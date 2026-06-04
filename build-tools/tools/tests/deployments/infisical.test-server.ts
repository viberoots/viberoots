#!/usr/bin/env zx-wrapper
import http from "node:http";
import { json, readBody, sameSecret, validateSecretWriteBody } from "./infisical.test-server-http";

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
  secretMetadata?: unknown;
  deleted?: boolean;
  revoked?: boolean;
  unavailable?: boolean;
  response?: Partial<FakeInfisicalSecret> & Record<string, unknown>;
  metadataResponse?: Partial<FakeInfisicalSecret> & Record<string, unknown>;
  status?: number;
  errorBody?: Record<string, unknown>;
};

export type FakeInfisicalServerOptions = {
  projectId?: string;
  environment?: string;
  machineIdentityId?: string;
  missingProject?: boolean;
  missingEnvironment?: boolean;
  projectStatus?: number;
  environmentStatus?: number;
  machineIdentityAccess?: boolean;
  machineIdentityAccessStatus?: number;
};

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
  const expectedProject = opts.projectId || "proj_123";
  const expectedEnvironment = opts.environment || "prod";
  const expectedIdentity = opts.machineIdentityId || "identity_123";
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
      if (opts.projectStatus)
        return json(response, opts.projectStatus, { error: "project_access_failed" });
      if (opts.missingProject || projectId !== expectedProject)
        return json(response, 404, { error: "missing_project" });
      json(response, 200, { workspace: { id: projectId, name: "Deployment Project" } });
      return;
    }
    const environmentMatch = url.pathname.match(
      /^\/api\/v1\/workspace\/([^/]+)\/environments\/([^/]+)$/,
    );
    if (environmentMatch) {
      const projectId = decodeURIComponent(environmentMatch[1] || "");
      const environment = decodeURIComponent(environmentMatch[2] || "");
      if (opts.environmentStatus)
        return json(response, opts.environmentStatus, { error: "environment_access_failed" });
      if (
        opts.missingEnvironment ||
        projectId !== expectedProject ||
        environment !== expectedEnvironment
      ) {
        return json(response, 404, { error: "missing_environment" });
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
      if (opts.machineIdentityAccessStatus)
        return json(response, opts.machineIdentityAccessStatus, {
          error: "identity_access_unavailable",
        });
      if (projectId !== expectedProject || identityId !== expectedIdentity)
        return json(response, 404, { error: "missing_identity_access" });
      json(response, 200, {
        access: {
          access: opts.machineIdentityAccess !== false,
          permissions: ["secrets:read"],
          evidence: "project-membership:member",
        },
      });
      return;
    }
    const oldSecretMatch = url.pathname.match(/^\/api\/v3\/secrets\/raw\/([^/]+)$/);
    if (oldSecretMatch) return json(response, 410, { error: "old_secret_read_path_rejected" });
    const secretMatch = url.pathname.match(/^\/api\/v4\/secrets\/([^/]+)$/);
    if (secretMatch) {
      const secretName = decodeURIComponent(secretMatch[1] || "");
      if (
        url.searchParams.has("workspaceId") ||
        url.searchParams.has("secretVersion") ||
        !url.searchParams.has("projectId") ||
        !url.searchParams.has("viewSecretValue")
      ) {
        return json(response, 400, { error: "invalid_v4_secret_read_contract" });
      }
      const viewSecretValue = url.searchParams.get("viewSecretValue") === "true";
      const version = url.searchParams.get("version") || "";
      secretCalls.push(`${secretName}:${String(viewSecretValue)}:${version}`);
      const found = secrets.find((entry) =>
        sameSecret(entry, url.searchParams, secretName, version),
      );
      if (request.method === "POST" || request.method === "PATCH") {
        const body = await readBody(request);
        const invalidWriteBody = validateSecretWriteBody(body, url.searchParams);
        if (invalidWriteBody) return json(response, 422, invalidWriteBody);
        if (!found) {
          secrets.push({
            projectId: url.searchParams.get("projectId") || "",
            environment: url.searchParams.get("environment") || "",
            secretPath: url.searchParams.get("secretPath") || "",
            secretName,
            secretValue: String(body.secretValue || ""),
            secretMetadata: body.secretMetadata,
            version: "v-written",
          });
        } else {
          found.secretValue = String(body.secretValue || "");
          found.secretMetadata = body.secretMetadata;
          found.version = "v-updated";
        }
        json(response, 200, { secret: { secretName, version: found ? "v-updated" : "v-written" } });
        return;
      }
      if (request.method === "DELETE") {
        const index = secrets.findIndex((entry) =>
          sameSecret(entry, url.searchParams, secretName, version),
        );
        if (index < 0) return json(response, 404, { error: "missing_secret" });
        secrets.splice(index, 1);
        return json(response, 200, { deleted: true });
      }
      if (!found) return json(response, 404, { error: "missing_secret" });
      if (found.status)
        return json(response, found.status, found.errorBody || { error: "secret_read_failed" });
      const returned = { ...found, ...(found.response || {}) };
      if (!viewSecretValue && found.metadataResponse)
        Object.assign(returned, found.metadataResponse);
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
