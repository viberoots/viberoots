#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "./deployment-secret-fixture";
import {
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
  VAULT_TOKEN_ENV,
} from "./deployment-secret-vault-credentials";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";

type ClientIdentityFields = {
  requestedBy?: unknown;
  authorization?: unknown;
  admissionEvidence?: unknown;
};

const CLIENT_CREDENTIAL_ENVS = [
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  VAULT_TOKEN_ENV,
  VAULT_AUTH_METHOD_ENV,
  VAULT_JWT_ENV,
  VAULT_JWT_FILE_ENV,
] as const;

function isProtectedShared(deployment: DeploymentTarget): boolean {
  return deployment.protectionClass !== "local_only";
}

function isServiceBackedProvider(deployment: DeploymentTarget): boolean {
  return ["cloudflare-pages", "kubernetes", "nixos-shared-host", "s3-static", "vercel"].includes(
    deployment.provider,
  );
}

function unauthorized(message: string): Error {
  return Object.assign(new DeploymentUnauthorizedError(message), { statusCode: 403 });
}

function hasEvidenceRequestedBy(evidence: unknown): boolean {
  return !!(
    evidence &&
    typeof evidence === "object" &&
    "requestedBy" in evidence &&
    (evidence as { requestedBy?: unknown }).requestedBy
  );
}

export function serviceSubmissionAdmissionEvidence(
  evidence: DeploymentAdmissionEvidence | undefined,
): DeploymentAdmissionEvidence | undefined {
  if (!evidence) return undefined;
  const { requestedBy: _requestedBy, ...rest } = evidence;
  return rest;
}

export function assertNoProtectedSharedClientIdentityFields(opts: {
  deployment: DeploymentTarget;
  request: ClientIdentityFields;
}) {
  if (!isProtectedShared(opts.deployment)) return;
  if (
    opts.request.requestedBy ||
    opts.request.authorization ||
    hasEvidenceRequestedBy(opts.request.admissionEvidence)
  ) {
    throw unauthorized(
      "protected/shared service submissions derive identity on the deployment service; client-supplied requestedBy or authorization grants are not trusted",
    );
  }
}

export function assertNoProtectedSharedClientCredentialInputs(opts: {
  deployment: DeploymentTarget;
  publicFrontDoor: boolean;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
  env?: NodeJS.ProcessEnv;
}) {
  if (
    !opts.publicFrontDoor ||
    !isProtectedShared(opts.deployment) ||
    !isServiceBackedProvider(opts.deployment)
  ) {
    return;
  }
  const env = opts.env || process.env;
  const activeEnv = CLIENT_CREDENTIAL_ENVS.find((name) => String(env[name] || "").trim());
  if (activeEnv) {
    throw new Error(
      `protected/shared service deployments must not use laptop credential input ${activeEnv}; authenticate through mini and let the worker use server-owned secrets`,
    );
  }
  const source = opts.vaultRuntimeInputs?.credentialSource;
  if (source && !source.startsWith("interactive")) {
    throw new Error(
      `protected/shared service deployments must not use client-side Vault credential source ${source}; authenticate through mini and let the worker use server-owned secrets`,
    );
  }
}
