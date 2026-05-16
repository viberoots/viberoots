#!/usr/bin/env zx-wrapper
import { providerTargetIdentityFor } from "../../deployments/contract";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges";
import type { DeploymentControlPlaneRole } from "../../deployments/deployment-control-plane-contract";
import {
  DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
  type DeploymentAuthSessionRecord,
} from "../../deployments/deployment-auth-session-types";
import { writeDeploymentAuthSession } from "../../deployments/deployment-auth-session-store";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

export function authRequiredDeployment(overrides = {}) {
  return {
    ...nixosSharedHostDeploymentFixture(overrides),
    vaultRuntime: {
      oidcIssuer: "https://identity.example.test",
      audience: "deployments-vault",
      cliPublicClientId: "deployment-cli",
      deploymentEnvironment: "mini",
      preferredCredentialSource: "interactive_pkce",
    },
  };
}

function grantFor(deployment: any, role: DeploymentControlPlaneRole) {
  return {
    role,
    scope:
      role === "operator"
        ? {
            kind: "provider_target_identity" as const,
            value: providerTargetIdentityFor(deployment),
          }
        : { kind: "deployment_id" as const, value: deployment.deploymentId },
  };
}

export async function writeAuthSession(opts: {
  recordsRoot: string;
  deployment: any;
  operationKind: string;
  principalId: string;
  role?: DeploymentControlPlaneRole;
  roles?: DeploymentControlPlaneRole[];
  expired?: boolean;
}) {
  const sessionId = `auth-${opts.operationKind}-${opts.principalId.replace(/[^a-z0-9]+/gi, "-")}`;
  const roles = opts.roles && opts.roles.length > 0 ? opts.roles : [opts.role || "submitter"];
  const session: DeploymentAuthSessionRecord = {
    schemaVersion: DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA,
    sessionId,
    status: "authenticated",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 60_000)).toISOString(),
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    credentialSource: "interactive_pkce",
    state: `state-${sessionId}`,
    nonce: "nonce",
    verifier: "verifier",
    issuer: "https://identity.example.test",
    tokenEndpoint: "https://identity.example.test/token",
    clientId: "deployment-cli",
    redirectUri: "https://deploy-auth.example.test/oidc/callback",
    boundClaims: {},
    principal: { principalId: opts.principalId },
    authorization: {
      requestedBy: { principalId: opts.principalId },
      grants: roles.map((role) => grantFor(opts.deployment, role)),
    },
  };
  await writeDeploymentAuthSession(opts.recordsRoot, session);
  await writeDeploymentAuthSession(
    {
      recordsRoot: opts.recordsRoot,
      backend: {
        recordsRoot: opts.recordsRoot,
        databaseUrl: localHarnessControlPlaneDatabaseUrl(opts.recordsRoot),
      },
    },
    session,
  );
  return sessionId;
}

export function evidenceWithoutPrincipal(deployment: any) {
  const { requestedBy: _requestedBy, ...evidence } = reviewedLaneAdmissionEvidenceFixture({
    deployment,
  });
  return evidence;
}

export async function postSubmission(url: string, body: any) {
  return await fetch(new URL("/api/v1/submissions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function withArtifactBinding(url: string, body: any) {
  const expected = await expectedNixosSharedHostArtifactIdentities({
    deployment: body.deployment,
    ...(body.artifactDir ? { artifactDir: body.artifactDir } : {}),
    ...(body.artifactDirsByComponentId
      ? { artifactDirsByComponentId: body.artifactDirsByComponentId }
      : {}),
  });
  const request = { ...body, ...expected };
  const challenge = await (
    await fetch(new URL("/api/v1/submission-challenges/artifact", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
  ).json();
  const principal = deploymentServicePrincipalForToken();
  return {
    ...request,
    artifactBindingProof: createArtifactBindingProof(
      artifactBindingEnvelope({
        request,
        principalId: principal.principalId,
        keyId: challenge.keyId,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        finalizedStagedArtifactReference:
          request.artifactDir || JSON.stringify(request.artifactDirsByComponentId),
      }),
      principal.proofSecret,
    ),
  };
}
