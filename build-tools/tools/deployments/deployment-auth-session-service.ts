#!/usr/bin/env zx-wrapper
import {
  authorizationUrl,
  discoverOidc,
  exchangePkceCodeForToken,
  randomSecret,
  validateOidcToken,
} from "./deployment-credential-source-oidc";
import { resolveDeploymentVaultRuntimePlan } from "./deployment-vault-runtime-plan";
import { authBlockingMissing, publicRedirectUri } from "./deployment-auth-session-service-helpers";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import {
  DEPLOYMENT_AUTH_LOGIN_RESPONSE_SCHEMA,
  DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
  DEPLOYMENT_AUTH_SESSION_STATUS_SCHEMA,
  type DeploymentAuthLoginRequest,
  type DeploymentAuthSessionRecord,
} from "./deployment-auth-session-types";
import {
  findDeploymentAuthSessionByState,
  readDeploymentAuthSession,
  writeDeploymentAuthSession,
  type DeploymentAuthSessionStoreTarget,
} from "./deployment-auth-session-store";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";
import {
  assertNonceIfPresent,
  authorizationForOidcPrincipal,
  principalFromOidcClaims,
} from "./deployment-auth-session-principal";
import {
  principalEmailFromOidcClaims,
  reviewedPrincipalEmailRequirementMessage,
  reviewedIdentityAdminGroupsFromOidcClaims,
} from "./deployment-auth-session-reviewed-identity";
import { normalizeAuthorizationSnapshot } from "./deployment-control-plane-authz";

const DEFAULT_SESSION_MS = 5 * 60 * 1000;
type AuthStoreOptions = { recordsRoot: string; backend?: NixosSharedHostControlPlaneBackendTarget };
type AuthAuthorizationOptions = AuthStoreOptions & {
  sessionId: string;
  deploymentId: string;
  operationKind: string;
};

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
    ...(session.principalEmail ? { principalEmail: session.principalEmail } : {}),
    ...(session.reviewedIdentityAdminGroups
      ? { reviewedIdentityAdminGroups: session.reviewedIdentityAdminGroups }
      : {}),
    ...(session.authorization
      ? { authorization: normalizeAuthorizationSnapshot(session.authorization) }
      : {}),
    ...(session.failure ? { failure: redactDeploymentAuthText(session.failure) } : {}),
  };
}

export async function createDeploymentAuthLoginSession(
  opts: AuthStoreOptions & {
    request: DeploymentAuthLoginRequest;
    env?: NodeJS.ProcessEnv;
  },
) {
  const store = authStore(opts);
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
  };
  await writeDeploymentAuthSession(store, session);
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

export async function handleDeploymentAuthCallback(
  opts: AuthStoreOptions & {
    state: string;
    code: string;
  },
) {
  const store = authStore(opts);
  const session = await findDeploymentAuthSessionByState(store, opts.state);
  if (!session) throw Object.assign(new Error("auth session not found"), { statusCode: 400 });
  if (session.status !== "pending" || session.callbackConsumedAt) {
    throw Object.assign(new Error("auth callback already consumed"), { statusCode: 410 });
  }
  const consumed = { ...session, callbackConsumedAt: new Date().toISOString() };
  await writeDeploymentAuthSession(store, consumed);
  try {
    const token = await exchangePkceCodeForToken({
      tokenEndpoint: consumed.tokenEndpoint,
      clientId: consumed.clientId,
      code: opts.code,
      redirectUri: consumed.redirectUri,
      verifier: consumed.verifier,
    });
    const claims = validateOidcToken({
      token,
      issuer: consumed.issuer,
      audience: [...new Set([consumed.audience, consumed.clientId].filter(Boolean))],
      clientId: consumed.clientId,
      boundClaims: consumed.boundClaims,
    });
    assertNonceIfPresent(claims, consumed.nonce);
    const principal = principalFromOidcClaims(claims);
    const principalEmail = principalEmailFromOidcClaims(claims);
    if (consumed.credentialSource.startsWith("interactive_") && !principalEmail) {
      throw new Error(reviewedPrincipalEmailRequirementMessage(principal.principalId));
    }
    const reviewedIdentityAdminGroups = reviewedIdentityAdminGroupsFromOidcClaims(claims);
    const authorization = authorizationForOidcPrincipal({
      deployment: consumed.deployment,
      principal,
      claims,
    });
    const authenticated = {
      ...consumed,
      status: "authenticated" as const,
      authenticatedAt: new Date().toISOString(),
      principal,
      ...(principalEmail ? { principalEmail } : {}),
      ...(reviewedIdentityAdminGroups.length > 0 ? { reviewedIdentityAdminGroups } : {}),
      authorization,
    };
    await writeDeploymentAuthSession(store, authenticated);
    return publicDeploymentAuthSessionStatus(authenticated);
  } catch (error) {
    const failed = {
      ...consumed,
      status: "failed" as const,
      failure: redactDeploymentAuthText(error instanceof Error ? error.message : String(error)),
    };
    await writeDeploymentAuthSession(store, failed);
    throw Object.assign(new Error(failed.failure), { statusCode: 400 });
  }
}

export async function readPublicDeploymentAuthSession(
  recordsRoot: string,
  sessionId: string,
  backend?: NixosSharedHostControlPlaneBackendTarget,
) {
  const session = await readDeploymentAuthSession(
    authStore({ recordsRoot, ...(backend ? { backend } : {}) }),
    sessionId,
  );
  return session ? publicDeploymentAuthSessionStatus(session) : undefined;
}

async function resolveDeploymentAuthSessionAuthorization(
  opts: AuthAuthorizationOptions & { consume: boolean },
) {
  const store = authStore(opts);
  const session = await readDeploymentAuthSession(store, opts.sessionId);
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
    await writeDeploymentAuthSession(store, { ...session, status: "consumed" });
  }
  return session.authorization;
}

export async function readDeploymentAuthSessionAuthorization(opts: AuthAuthorizationOptions) {
  return await resolveDeploymentAuthSessionAuthorization({ ...opts, consume: false });
}

export async function consumeDeploymentAuthSessionAuthorization(opts: AuthAuthorizationOptions) {
  return await resolveDeploymentAuthSessionAuthorization({ ...opts, consume: true });
}

function authStore(opts: AuthStoreOptions): DeploymentAuthSessionStoreTarget {
  return opts.backend ? { recordsRoot: opts.recordsRoot, backend: opts.backend } : opts.recordsRoot;
}
