import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  type ControlPlaneRuntimeConfig,
  type DeploymentInfisicalCredentialFiles,
  type DeploymentInfisicalCredentialRequest,
} from "./control-plane-runtime-config-types";
import {
  assertCredentialDirectoryPath,
  resolveCredentialFileName,
} from "./control-plane-runtime-config-paths";
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";

export type ControlPlaneCredentialDirectory = {
  directory: string;
  resolveInfisicalCredentialFiles(
    request: DeploymentInfisicalCredentialRequest,
  ): DeploymentInfisicalCredentialFiles;
  readCredentialFile(filePath: string): Promise<string>;
};

export function createControlPlaneCredentialDirectory(
  config: ControlPlaneRuntimeConfig,
  options: { repoRoot?: string } = {},
): ControlPlaneCredentialDirectory {
  const directory = path.resolve(config.credentials.directory);
  const policy = { credentialDirectory: directory, repoRoot: options.repoRoot };
  return {
    directory,
    resolveInfisicalCredentialFiles(request) {
      const clientIdName = exactInfisicalCredentialFileName(
        request.clientIdFileName,
        config.credentials.defaults.infisicalClientIdFilePattern,
        request.deploymentId,
        "clientIdFileName",
      );
      const clientSecretName = exactInfisicalCredentialFileName(
        request.clientSecretFileName,
        config.credentials.defaults.infisicalClientSecretFilePattern,
        request.deploymentId,
        "clientSecretFileName",
      );
      return {
        ...request,
        clientIdFile: assertCredentialDirectoryPath(
          resolveCredentialFileName(directory, clientIdName),
          policy,
        ),
        clientSecretFile: assertCredentialDirectoryPath(
          resolveCredentialFileName(directory, clientSecretName),
          policy,
        ),
      };
    },
    async readCredentialFile(filePath) {
      const resolved = assertCredentialDirectoryPath(filePath, policy);
      try {
        return (await fsp.readFile(resolved, "utf8")).trimEnd();
      } catch (error) {
        throw new Error(
          redactConfigDiagnostic(`failed to read credential file ${resolved}: ${error}`),
        );
      }
    },
  };
}

function exactInfisicalCredentialFileName(
  requestedName: string | undefined,
  pattern: string,
  deploymentId: string,
  fieldName: string,
): string {
  const expected = applyDeploymentPattern(pattern, deploymentId);
  if (requestedName !== undefined && requestedName !== expected) {
    throw new Error(`${fieldName} must be exactly ${expected}`);
  }
  return expected;
}

export function applyDeploymentPattern(pattern: string, deploymentId: string): string {
  if (!/^[a-z0-9._-]+$/i.test(deploymentId)) {
    throw new Error("deploymentId contains characters that cannot be used in credential filenames");
  }
  return pattern.replaceAll("{deploymentId}", deploymentId);
}
