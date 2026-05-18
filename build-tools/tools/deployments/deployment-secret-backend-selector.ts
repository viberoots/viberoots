#!/usr/bin/env zx-wrapper
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";

const BACKENDS = ["vault", "infisical"] as const;
const BACKEND_SET: ReadonlySet<string> = new Set(BACKENDS);
const PROFILE_ALIAS = /^[a-z0-9][a-z0-9-]*$/;

export type DeploymentSecretBackendSelector = {
  backend: DeploymentSecretBackendKind;
  profile: string;
};

export function defaultDeploymentSecretBackendProfile(backend: DeploymentSecretBackendKind) {
  return backend === "infisical" ? "infisical-default" : "vault-default";
}

export function isDeploymentSecretBackendProfile(value: string) {
  return PROFILE_ALIAS.test(value);
}

export function normalizeDeploymentSecretBackendSelector(opts: {
  secretBackend?: string;
  secretBackendProfile?: string;
}): DeploymentSecretBackendSelector {
  const backendValue = (opts.secretBackend || "").trim();
  if (!backendValue) return { backend: "vault", profile: "vault-default" };
  return normalizeUnifiedSelector(backendValue);
}

export function deploymentSecretBackendSelectorErrors(opts: {
  secretBackend?: string;
  secretBackendProfile?: string;
}) {
  const backendValue = (opts.secretBackend || "").trim();
  const explicitProfile = (opts.secretBackendProfile || "").trim();
  const errors = backendValue ? unifiedSelectorErrors(backendValue) : [];
  if (explicitProfile) {
    errors.push(
      'secret_backend_profile is unsupported; use secret_backend = "<backend>/<profile-alias>"',
    );
  }
  return errors;
}

function normalizeUnifiedSelector(selector: string): DeploymentSecretBackendSelector {
  const [backendPart = "vault", aliasPart = "default"] = selector.split("/");
  const backend = supportedBackend(backendPart);
  return { backend, profile: `${backend}-${aliasPart}` };
}

function unifiedSelectorErrors(selector: string) {
  const parts = selector.split("/");
  const [backend = "", alias = ""] = parts;
  const errors: string[] = [];
  if (parts.length !== 2 || !backend || !alias) {
    errors.push(
      'secret_backend must use "<backend>/<profile-alias>", for example "infisical/default"',
    );
  }
  if (backend && !BACKEND_SET.has(backend)) {
    errors.push(`unsupported secret_backend backend "${backend}"`);
  }
  if (alias && (!PROFILE_ALIAS.test(alias) || isGlobalProfileAlias(alias))) {
    errors.push(
      "secret_backend profile alias must be backend-local kebab-case, for example default or regulated",
    );
  }
  return errors;
}

function supportedBackend(value: string): DeploymentSecretBackendKind {
  return BACKEND_SET.has(value) ? (value as DeploymentSecretBackendKind) : "vault";
}

function isGlobalProfileAlias(alias: string) {
  return BACKENDS.some((backend) => alias.startsWith(`${backend}-`));
}
