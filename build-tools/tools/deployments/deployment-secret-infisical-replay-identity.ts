#!/usr/bin/env zx-wrapper
import type { DeploymentSecretAdmittedReference } from "./deployment-sprinkle-ref";
import type { InfisicalSecretRecord } from "./deployment-secret-infisical-client";
import {
  deploymentInfisicalBackendRef,
  deploymentInfisicalSelectorRef,
  parseDeploymentInfisicalBackendRef,
  type DeploymentInfisicalSelector,
} from "./deployment-secret-infisical-selectors";

const REQUIRED_RESPONSE_FIELDS = [
  ["provider secret id", "id"],
  ["project id", "projectId"],
  ["environment", "environment"],
  ["secret path", "secretPath"],
  ["secret name", "secretName"],
  ["version", "version"],
] as const;

export function assertInfisicalReplayEvidence(opts: {
  record: InfisicalSecretRecord;
  contractId: string;
  requestedSelector: DeploymentInfisicalSelector;
}) {
  const missing = REQUIRED_RESPONSE_FIELDS.filter(
    ([, field]) => !String(opts.record[field] || "").trim(),
  ).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(
      `required secret contract ${opts.contractId} missing Infisical replay identity evidence: ${missing.join(
        ", ",
      )}; requested selector: ${deploymentInfisicalSelectorRef(opts.requestedSelector)}`,
    );
  }
}

export function infisicalProviderBackendRef(opts: {
  record: InfisicalSecretRecord;
  contractId: string;
  requestedSelector: DeploymentInfisicalSelector;
}) {
  assertInfisicalReplayEvidence(opts);
  const { record } = opts;
  return deploymentInfisicalBackendRef(record, {
    id: record.id,
    reference: record.reference,
  });
}

export function assertInfisicalFrozenReplayEvidence(admitted: DeploymentSecretAdmittedReference) {
  const parsed = parseDeploymentInfisicalBackendRef(admitted.backendRef);
  const missing = [
    ["provider secret id", parsed.identity.id],
    ["project id", parsed.selector.projectId],
    ["environment", parsed.selector.environment],
    ["secret path", parsed.selector.secretPath],
    ["secret name", parsed.selector.secretName],
    ["version", admitted.resolvedVersion],
  ].filter(([, value]) => !String(value || "").trim());
  if (missing.length > 0) {
    throw new Error(
      `required secret contract ${admitted.contractId} has incomplete Infisical replay reference: ${missing
        .map(([label]) => label)
        .join(", ")}`,
    );
  }
  return parsed;
}
