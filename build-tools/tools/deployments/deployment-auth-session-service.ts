#!/usr/bin/env zx-wrapper
import {
  authorizationUrl,
  discoverOidc,
  exchangePkceCodeForToken,
  randomSecret,
  validateOidcToken,
} from "./deployment-credential-source-oidc.ts";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan.ts";
import {
  normalizeDeploymentPkceCallbackProfile,
  urlHost,
} from "./deployment-pkce-callback-profile.ts";
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import {
  DEPLOYMENT_AUTH_LOGIN_RESPONSE_SCHEMA,
  DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
  DEPLOYMENT_AUTH_SESSION_STATUS_SCHEMA,
  type DeploymentAuthLoginRequest,
  type DeploymentAuthSessionRecord,
} from "./deployment-auth-session-types.ts";
import {
  findDeploymentAuthSessionByState,
  readDeploymentAuthSession,
  writeDeploymentAuthSession,
} from "./deployment-auth-session-store.ts";
import {
  assertNonceIfPresent,
  authorizationForOidcPrincipal,
  principalFromOidcClaims,
} from "./deployment-auth-session-principal.ts";

const DEFAULT_SESSION_MS = 5 * 60 * 1000;

function authBlockingMissing(missing: string[]): string[] {
  return missing.filter(
    (entry) =>
      entry.includes("Vault JWT auth") || entry.includes("lane governance repository metadata"),
  );
}

function redirectUriFor(session: DeploymentAuthSessionRecord): string {
  return session.redirectUri;
}

function publicRedirectUri(input: DeploymentAuthLoginRequest): string {
  const profile = normalizeDeploymentPkceCallbackProfile(
    input.deployment.vaultRuntime?.pkceCallback || {
      mode: "public_host",
      externalScheme: "https",
      externalHost: "deploy-auth.apps.kilty.io",
      externalPath: "/oidc/callback",
      bindHost: "127.0.0.1",
      bindPort: 7780,
      bindPath: "/oidc/callback",
    },
  );
  const port = profile.externalPort ? `:${profile.externalPort}` : "";
  return `${profile.externalScheme}://${urlHost(profile.externalHost)}${port}${profile.externalPath}`;
}

export function publicDeploymentAuthSessionStatus(session: DeploymentAuthSessionRecord) {
  return {
    schemaVersion: DEPLOYMENT_AUTH_SESSION_STATUS_SCHEMA,
    sessionId: session.sessionId,
    status: session.status,
    expiresAt: session.expiresAt,
    deploymentId: session.deployment.deploymentId,
    operationKind: session.operationKind,
    credentialSource: session.credentialSource,
    ...(session.principal ? { principal: session.principal } : {}),
    ...(session.authorization ? { authorization: session.authorization } : {}),
    ...(session.failure ? { failure: redactDeploymentAuthText(session.failure) } : {}),
  };
}

export async function createDeploymentAuthLoginSession(opts: {
  recordsRoot: string;
  request: DeploymentAuthLoginRequest;
  env?: NodeJS.ProcessEnv;
}) {
  const plan = resolveDeploymentVaultRuntimePlan({
    deployment: opts.request.deployment,
    env: opts.env || process.env,
  });
  const missing = authBlockingMissing(plan.missing);
  if (missing.length > 0) throw new Error(missing[0]);
  const discovery = await discoverOidc(plan.issuerUrl);
  const sessionId = `auth_${randomSecret(18)}`;
  const verifier = randomSecret(48);
  const state = randomSecret();
  const nonce = randomSecret();
  const now = Date.now();
  const expiresAt = new Date(now + (opts.request.expiresInMs || DEFAULT_SESSION_MS)).toISOString();
  const redirectUri = publicRedirectUri(opts.request);
  const credentialSource = opts.request.credentialSource || "interactive_pkce";
  const session: DeploymentAuthSessionRecord = {
    schemaVersion: DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
    sessionId,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt,
    deployment: opts.request.deployment,
    operationKind: opts.request.operationKind,
    credentialSource,
    state,
    nonce,
    verifier,
    issuer: discovery.issuer,
    tokenEndpoint: discovery.tokenEndpoint,
    clientId: plan.humanClientId,
    audience: plan.audience,
    redirectUri,
    boundClaims: {
      deployment_environment: plan.deploymentEnvironment,
      repository: plan.repository,
    },
    ...(plan.humanClaim ? { humanClaim: plan.humanClaim } : {}),
  };
  await writeDeploymentAuthSession(opts.recordsRoot, session);
  return {
    schemaVersion: DEPLOYMENT_AUTH_LOGIN_RESPONSE_SCHEMA,
    sessionId,
    loginUrl: authorizationUrl({
      endpoint: discovery.authorizationEndpoint,
      clientId: session.clientId,
      redirectUri,
      verifier,
      state,
      nonce,
      audience: session.audience,
    }),
    redirectUri,
    status: session.status,
    expiresAt,
    credentialSource,
  };
}

export async function handleDeploymentAuthCallback(opts: {
  recordsRoot: string;
  state: string;
  code: string;
}) {
  const session = await findDeploymentAuthSessionByState(opts.recordsRoot, opts.state);
  if (!session) throw Object.assign(new Error("auth session not found"), { statusCode: 400 });
  if (session.status !== "pending" || session.callbackConsumedAt) {
    throw Object.assign(new Error("auth callback already consumed"), { statusCode: 410 });
  }
  const consumed = { ...session, callbackConsumedAt: new Date().toISOString() };
  await writeDeploymentAuthSession(opts.recordsRoot, consumed);
  try {
    const token = await exchangePkceCodeForToken({
      tokenEndpoint: consumed.tokenEndpoint,
      clientId: consumed.clientId,
      code: opts.code,
      redirectUri: redirectUriFor(consumed),
      verifier: consumed.verifier,
    });
    const claims = validateOidcToken({
      token,
      issuer: consumed.issuer,
      audience: [...new Set([consumed.audience, consumed.clientId].filter(Boolean))],
      clientId: consumed.clientId,
      boundClaims: consumed.boundClaims,
      humanClaim: consumed.humanClaim,
    });
    assertNonceIfPresent(claims, consumed.nonce);
    const principal = principalFromOidcClaims(claims);
    const authorization = authorizationForOidcPrincipal({
      deployment: consumed.deployment,
      operationKind: consumed.operationKind,
      principal,
    });
    const authenticated = {
      ...consumed,
      status: "authenticated" as const,
      authenticatedAt: new Date().toISOString(),
      principal,
      authorization,
    };
    await writeDeploymentAuthSession(opts.recordsRoot, authenticated);
    return publicDeploymentAuthSessionStatus(authenticated);
  } catch (error) {
    const failed = {
      ...consumed,
      status: "failed" as const,
      failure: redactDeploymentAuthText(error instanceof Error ? error.message : String(error)),
    };
    await writeDeploymentAuthSession(opts.recordsRoot, failed);
    throw Object.assign(new Error(failed.failure), { statusCode: 400 });
  }
}

export async function readPublicDeploymentAuthSession(recordsRoot: string, sessionId: string) {
  const session = await readDeploymentAuthSession(recordsRoot, sessionId);
  return session ? publicDeploymentAuthSessionStatus(session) : undefined;
}

async function resolveDeploymentAuthSessionAuthorization(opts: {
  recordsRoot: string;
  sessionId: string;
  deploymentId: string;
  operationKind: string;
  consume: boolean;
}) {
  const session = await readDeploymentAuthSession(opts.recordsRoot, opts.sessionId);
  if (!session) throw Object.assign(new Error("auth session not found"), { statusCode: 403 });
  if (session.deployment.deploymentId !== opts.deploymentId) {
    throw Object.assign(new Error("auth session deployment mismatch"), { statusCode: 403 });
  }
  if (session.operationKind !== opts.operationKind) {
    throw Object.assign(new Error("auth session operation mismatch"), { statusCode: 403 });
  }
  if (session.status !== "authenticated" || !session.authorization) {
    throw Object.assign(new Error(`auth session is not authenticated: ${session.status}`), {
      statusCode: 403,
    });
  }
  if (opts.consume) {
    await writeDeploymentAuthSession(opts.recordsRoot, { ...session, status: "consumed" });
  }
  return session.authorization;
}

export async function readDeploymentAuthSessionAuthorization(opts: {
  recordsRoot: string;
  sessionId: string;
  deploymentId: string;
  operationKind: string;
}) {
  return await resolveDeploymentAuthSessionAuthorization({ ...opts, consume: false });
}

export async function consumeDeploymentAuthSessionAuthorization(opts: {
  recordsRoot: string;
  sessionId: string;
  deploymentId: string;
  operationKind: string;
}) {
  return await resolveDeploymentAuthSessionAuthorization({ ...opts, consume: true });
}
