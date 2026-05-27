import path from "node:path";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";

export function reviewedSourceCredentialFiles(
  config: ControlPlaneRuntimeConfig,
): [string, string][] {
  if (config.reviewedSource.mode === "github-app") {
    return [
      ["reviewedSource.githubAppIdFile", config.reviewedSource.githubAppIdFile],
      [
        "reviewedSource.githubAppInstallationIdFile",
        config.reviewedSource.githubAppInstallationIdFile,
      ],
      ["reviewedSource.githubAppPrivateKeyFile", config.reviewedSource.githubAppPrivateKeyFile],
    ];
  }
  return [
    ["reviewedSource.sshKeyFile", config.reviewedSource.sshKeyFile],
    ["reviewedSource.sshKnownHostsFile", config.reviewedSource.sshKnownHostsFile],
  ];
}

export function validateReviewedSourceFilenameContract(config: ControlPlaneRuntimeConfig): void {
  const expected =
    config.reviewedSource.mode === "github-app"
      ? {
          githubAppIdFile: "reviewed-source-github-app-id",
          githubAppInstallationIdFile: "reviewed-source-github-app-installation-id",
          githubAppPrivateKeyFile: "reviewed-source-github-app-private-key",
        }
      : {
          sshKeyFile: "reviewed-source-ssh-key",
          sshKnownHostsFile: "reviewed-source-known-hosts",
        };
  for (const [field, fileName] of Object.entries(expected)) {
    const filePath = (config.reviewedSource as Record<string, string>)[field];
    if (path.basename(String(filePath)) !== fileName) {
      throw new Error(`reviewedSource.${field} must use credential filename ${fileName}`);
    }
  }
}
