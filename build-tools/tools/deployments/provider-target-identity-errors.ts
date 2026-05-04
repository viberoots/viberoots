#!/usr/bin/env zx-wrapper
import { deploymentError, duplicateValueEntries } from "./contract-extract-shared";

export function pushDuplicateProviderTargetIdentityErrors(
  errors: string[],
  deployments: Array<{ label: string; providerTarget: { providerTargetIdentity: string } }>,
) {
  for (const duplicate of duplicateValueEntries(
    deployments.map((deployment) => ({
      value: deployment.providerTarget.providerTargetIdentity,
      label: deployment.label,
    })),
  )) {
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
