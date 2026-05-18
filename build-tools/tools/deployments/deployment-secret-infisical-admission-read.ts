#!/usr/bin/env zx-wrapper
import type { DeploymentSecretContext } from "./deployment-secret-context";
import {
  readInfisicalSecret,
  type InfisicalSecretRecord,
} from "./deployment-secret-infisical-client";
import type { deploymentInfisicalSelector } from "./deployment-secret-infisical-selectors";

export async function readAdmittedInfisicalSecret(opts: {
  credential: DeploymentSecretContext & { kind: "infisical" };
  selector: ReturnType<typeof deploymentInfisicalSelector>;
}): Promise<InfisicalSecretRecord | undefined> {
  const metadata = await readInfisicalSecretForAdmission(opts, false);
  if (!metadata || metadata.version || unusable(metadata)) return metadata;
  const valueBackedMetadata = await readInfisicalSecretForAdmission(opts, true);
  if (!valueBackedMetadata) return metadata;
  const { secretValue: _discardedSecretValue, ...withoutSecretValue } = valueBackedMetadata;
  return withoutSecretValue;
}

function unusable(record: InfisicalSecretRecord) {
  return record.deleted || record.revoked || record.unavailable;
}

async function readInfisicalSecretForAdmission(
  opts: {
    credential: DeploymentSecretContext & { kind: "infisical" };
    selector: ReturnType<typeof deploymentInfisicalSelector>;
  },
  viewSecretValue: boolean,
) {
  return await readInfisicalSecret({
    credential: opts.credential.credential,
    selector: opts.selector,
    viewSecretValue,
  });
}
