import type { DeploymentInfisicalCredentialRequest } from "./control-plane-runtime-config-types";

export function deploymentInfisicalCredentialRequests(
  value: unknown,
): DeploymentInfisicalCredentialRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("credentials.infisicalDeployments must be a list");
  return value.map((entry, index) => {
    const prefix = `credentials.infisicalDeployments[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${prefix} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const request: DeploymentInfisicalCredentialRequest = {
      deploymentId: stringField(record.deploymentId, `${prefix}.deploymentId`),
      siteUrl: stringField(record.siteUrl, `${prefix}.siteUrl`),
      projectId: stringField(record.projectId, `${prefix}.projectId`),
      environment: stringField(record.environment, `${prefix}.environment`),
    };
    if (record.clientIdFileName !== undefined) {
      request.clientIdFileName = stringField(record.clientIdFileName, `${prefix}.clientIdFileName`);
    }
    if (record.clientSecretFileName !== undefined) {
      request.clientSecretFileName = stringField(
        record.clientSecretFileName,
        `${prefix}.clientSecretFileName`,
      );
    }
    return request;
  });
}

function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}
