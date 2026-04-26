#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type { DeploymentCredentialSource } from "./deployment-credential-source-selection.ts";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract.ts";

export const DEPLOYMENT_AUTH_LOGIN_REQUEST_SCHEMA = "deployment-auth-login-request@1";
export const DEPLOYMENT_AUTH_LOGIN_RESPONSE_SCHEMA = "deployment-auth-login-response@1";
export const DEPLOYMENT_AUTH_SESSION_STATUS_SCHEMA = "deployment-auth-session-status@1";
export const DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA = "deployment-auth-session-record@1";

export type DeploymentAuthSessionState =
  | "pending"
  | "authenticated"
  | "failed"
  | "expired"
  | "consumed";

export type DeploymentAuthLoginRequest = {
  schemaVersion?: typeof DEPLOYMENT_AUTH_LOGIN_REQUEST_SCHEMA;
  deployment: DeploymentTarget;
  operationKind: string;
  credentialSource?: DeploymentCredentialSource;
  expiresInMs?: number;
};

export type DeploymentAuthLoginResponse = {
  schemaVersion: typeof DEPLOYMENT_AUTH_LOGIN_RESPONSE_SCHEMA;
  sessionId: string;
  loginUrl: string;
  redirectUri: string;
  status: DeploymentAuthSessionState;
  expiresAt: string;
  credentialSource: DeploymentCredentialSource;
};

export type DeploymentAuthSessionStatus = {
  schemaVersion: typeof DEPLOYMENT_AUTH_SESSION_STATUS_SCHEMA;
  sessionId: string;
  status: DeploymentAuthSessionState;
  expiresAt: string;
  deploymentId: string;
  operationKind: string;
  credentialSource: DeploymentCredentialSource;
  principal?: DeploymentPrincipal;
  principalEmail?: string;
  reviewedKeycloakAdminGroups?: string[];
  authorization?: DeploymentControlPlaneAuthorization;
  failure?: string;
};

export type DeploymentAuthSessionRecord = {
  schemaVersion: typeof DEPLOYMENT_AUTH_SESSION_RECORD_SCHEMA;
  sessionId: string;
  status: DeploymentAuthSessionState;
  createdAt: string;
  expiresAt: string;
  deployment: DeploymentTarget;
  operationKind: string;
  credentialSource: DeploymentCredentialSource;
  state: string;
  nonce: string;
  verifier: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  audience?: string;
  redirectUri: string;
  boundClaims: Record<string, string>;
  callbackConsumedAt?: string;
  authenticatedAt?: string;
  principal?: DeploymentPrincipal;
  principalEmail?: string;
  reviewedKeycloakAdminGroups?: string[];
  authorization?: DeploymentControlPlaneAuthorization;
  failure?: string;
};
