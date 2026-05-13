#!/usr/bin/env zx-wrapper
import { createRegisteredDeploymentSecretBackend } from "./deployment-secret-backend-registry";
import { createDeploymentSecretRuntime } from "./deployment-secret-runtime";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type {
  DeploymentSecretBackendKind,
  DeploymentSecretReference,
} from "./deployment-sprinkle-ref";

type AdmittedContextLike = {
  admittedSecretReferences?: unknown[];
  secretRequirements?: unknown[];
  secretBackend?: DeploymentSecretBackendKind;
  targetEnvironment?: { lockScope?: string };
};

function admittedReferencesFrom(
  admittedContext?: AdmittedContextLike,
): DeploymentSecretReference[] {
  return (admittedContext?.admittedSecretReferences || []) as DeploymentSecretReference[];
}

function backendFromAdmittedReferences(
  references: DeploymentSecretReference[],
): DeploymentSecretBackendKind | undefined {
  const backends = new Set(references.map((reference) => reference.backend));
  if (backends.size > 1) {
    throw new Error(
      `deployment secret runtime cannot mix backends in one admitted context: ${[...backends].join(", ")}`,
    );
  }
  return [...backends][0];
}

function selectedBackend(opts: {
  admittedContext?: AdmittedContextLike;
  forcedBackend?: DeploymentSecretBackendKind;
  defaultBackend?: DeploymentSecretBackendKind;
}): DeploymentSecretBackendKind {
  const admittedBackend = backendFromAdmittedReferences(
    admittedReferencesFrom(opts.admittedContext),
  );
  const backend =
    admittedBackend || opts.admittedContext?.secretBackend || opts.defaultBackend || "vault";
  if (opts.forcedBackend && backend !== opts.forcedBackend) {
    throw new Error(
      `deployment secret runtime expected ${opts.forcedBackend} backend but admitted context uses ${backend}`,
    );
  }
  return opts.forcedBackend || backend;
}

type DeploymentSecretRuntimeForAdmittedContextOpts = {
  authority?: { kind?: string };
  admittedContext?: AdmittedContextLike;
  defaultBackend?: DeploymentSecretBackendKind;
  fallbackTargetScope?: string;
  secretContext?: DeploymentSecretContext;
};

function createRuntimeForAdmittedContext(
  opts: DeploymentSecretRuntimeForAdmittedContextOpts & {
    forcedBackend?: DeploymentSecretBackendKind;
  },
) {
  const backend = selectedBackend(opts);
  return createDeploymentSecretRuntime({
    authority: opts.authority,
    backend: createRegisteredDeploymentSecretBackend({
      backend,
      secretContext: opts.secretContext,
    }),
    secretBackend: backend,
    admittedReferences: admittedReferencesFrom(opts.admittedContext),
    requirements: (opts.admittedContext?.secretRequirements || []) as any[],
    targetScope:
      opts.admittedContext?.targetEnvironment?.lockScope || opts.fallbackTargetScope || "unknown",
  });
}

export function createDeploymentSecretRuntimeForAdmittedContext(
  opts: DeploymentSecretRuntimeForAdmittedContextOpts,
) {
  return createRuntimeForAdmittedContext(opts);
}

export function createVaultDeploymentSecretRuntime(opts: {
  authority?: { kind?: string };
  admittedContext?: AdmittedContextLike;
  fallbackTargetScope?: string;
  secretContext?: DeploymentSecretContext;
}) {
  return createRuntimeForAdmittedContext({
    ...opts,
    forcedBackend: "vault",
  });
}
