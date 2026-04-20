#!/usr/bin/env zx-wrapper
import { deploymentError, duplicateValueEntries } from "./contract-extract-shared.ts";

export const MOBILE_STORE_TARGET_TOKEN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
export const MOBILE_STORE_VALID_PROTECTION_CLASSES = new Set([
  "shared_nonprod",
  "production_facing",
]);
export const APP_STORE_CONNECT_VALID_SIGNING_MODELS = new Set(["app-store"]);
export const APP_STORE_CONNECT_VALID_TRACKS = new Set([
  "testflight-internal",
  "testflight-external",
  "app-store",
]);

export function pushDuplicateProviderTargetErrors(
  errors: string[],
  duplicates: Array<{ value: string; labels: string[] }>,
) {
  for (const duplicate of duplicates) {
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

export function pushDuplicateProviderTargetIdentityErrors(
  errors: string[],
  deployments: Array<{ label: string; providerTarget: { providerTargetIdentity: string } }>,
) {
  pushDuplicateProviderTargetErrors(
    errors,
    duplicateValueEntries(
      deployments.map((deployment) => ({
        value: deployment.providerTarget.providerTargetIdentity,
        label: deployment.label,
      })),
    ),
  );
}

export function pushMobileStoreProtectionClassError(opts: {
  label: string;
  provider: "app-store-connect" | "google-play";
  protectionClass: string;
  errors: string[];
}) {
  if (MOBILE_STORE_VALID_PROTECTION_CLASSES.has(opts.protectionClass)) return;
  opts.errors.push(
    deploymentError(
      opts.label,
      `${opts.provider} deployments must use protection_class "shared_nonprod" or "production_facing"`,
    ),
  );
}
