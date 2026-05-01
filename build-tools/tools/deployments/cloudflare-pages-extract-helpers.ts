#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import type { DeploymentPreviewPolicy } from "./contract-types.ts";
import { deploymentError, duplicateValueEntries } from "./contract-extract-shared.ts";
import { allowsSharedTargetTransition } from "./deployment-target-exceptions.ts";

export function pushCloudflarePreviewErrors(
  label: string,
  preview: DeploymentPreviewPolicy | undefined,
  errors: string[],
) {
  if (!preview) return;
  if (preview.targetDerivation !== "provider_managed_source_run") {
    errors.push(
      deploymentError(
        label,
        'preview.target_derivation must be "provider_managed_source_run"; preview must not reuse the normal live target',
      ),
    );
  }
  if (preview.isolationClass !== "isolated") {
    errors.push(deploymentError(label, 'preview.isolation_class must be "isolated"'));
  }
  if (preview.identitySelector !== "source_run") {
    errors.push(
      deploymentError(label, 'cloudflare-pages preview.identity_selector must be "source_run"'),
    );
  }
  if (preview.smokeTarget !== "preview_url") {
    errors.push(
      deploymentError(label, 'cloudflare-pages preview.smoke_target must be "preview_url"'),
    );
  }
  if (preview.lockScope !== "shared") {
    errors.push(
      deploymentError(label, 'cloudflare-pages preview.lock_scope must currently be "shared"'),
    );
  }
}

export function allowsCloudflareAliasCollision(
  deployments: CloudflarePagesDeployment[],
  providerTargetIdentity: string,
): boolean {
  const matching = deployments.filter(
    (deployment) => deployment.providerTarget.providerTargetIdentity === providerTargetIdentity,
  );
  return matching.some((deployment) =>
    deployment.targetExceptions.some((exception) =>
      allowsSharedTargetTransition(
        exception,
        matching.map((entry) => entry.deploymentId),
        providerTargetIdentity,
      ),
    ),
  );
}

export function pushDuplicateCloudflareTargetIdentityErrors(
  errors: string[],
  deployments: CloudflarePagesDeployment[],
) {
  for (const duplicate of duplicateValueEntries(
    deployments.map((deployment) => ({
      value: deployment.providerTarget.providerTargetIdentity,
      label: deployment.label,
    })),
  )) {
    if (allowsCloudflareAliasCollision(deployments, duplicate.value)) continue;
    for (const label of duplicate.labels) {
      errors.push(
        deploymentError(
          label,
          `duplicate provider_target identity "${duplicate.value}" collides with ${duplicate.labels.join(", ")}`,
        ),
      );
    }
  }
}
