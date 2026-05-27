import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";

export const DEFAULT_CONTROL_PLANE_CONFIG_PATH = "/etc/deployment-control-plane/config.yaml";

export type ControlPlaneMode = "protected-shared" | "dedicated";

export type ControlPlaneProcessMode =
  | "fully-enabled"
  | "service-only"
  | "worker-only"
  | "fully-disabled";

export type ControlPlaneRuntimeConfig = {
  instanceId: string;
  mode: ControlPlaneMode;
  processMode: ControlPlaneProcessMode;
  service: {
    host: string;
    port: number;
    publicUrl: string;
    tokenFile: string;
  };
  storage: {
    recordsRoot: string;
    artifactStagingRoot: string;
    runtimeRoot: string;
    artifactStore: {
      kind: "s3-compatible";
      bucket: string;
      region: string;
      endpointFile: string;
      accessKeyIdFile: string;
      secretAccessKeyFile: string;
    };
  };
  database: {
    urlFile: string;
  };
  credentials: {
    directory: string;
    defaults: {
      infisicalClientIdFilePattern: string;
      infisicalClientSecretFilePattern: string;
    };
  };
  reviewedSource: {
    sshKeyFile: string;
    sshKnownHostsFile: string;
  };
  webUi: {
    enabled: boolean;
    basePath: string;
  };
  mcp: {
    enabled: boolean;
    basePath: string;
  };
  authProvider: DeploymentAuthProviderConfig;
  miniMigrationPreflight: {
    enabled: boolean;
  };
};

export type DeploymentInfisicalCredentialRequest = {
  deploymentId: string;
  siteUrl: string;
  projectId: string;
  environment: string;
  clientIdFileName?: string;
  clientSecretFileName?: string;
};

export type DeploymentInfisicalCredentialFiles = DeploymentInfisicalCredentialRequest & {
  clientIdFile: string;
  clientSecretFile: string;
};
