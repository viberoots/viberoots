import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import type { ReviewedSourceCredentialFiles } from "./nixos-shared-host-reviewed-source-git";

export type NixosSharedHostControlPlaneServerOptions = {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backendDatabaseUrl: string;
  host?: string;
  port?: number;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  objectStore?: ControlPlaneArtifactStore;
  instanceId?: string;
  webUi?: { enabled: boolean; basePath: string };
  mcp?: { enabled: boolean; basePath: string };
  reviewedSourceCredentials?: ReviewedSourceCredentialFiles;
  miniMigrationPreflight?: { enabled: boolean };
  authProvider?: DeploymentAuthProviderConfig;
};
