#!/usr/bin/env zx-wrapper
import type {
  DeploymentResourceKind,
  ResourceAuthority,
  ResourceSourceClass,
} from "./resource-graph-taxonomy";

export type DeploymentResourceSource = {
  class: ResourceSourceClass;
  path?: string;
  label?: string;
};

export type DeploymentResourceInventoryEntry = {
  kind: DeploymentResourceKind;
  id: string;
  authority: ResourceAuthority;
  source: DeploymentResourceSource;
  refs?: string[];
  facts?: Record<string, unknown>;
};

export type RuntimeValidationOptions = {
  expectedCallbackHost: string;
  expectedCallbackPath: string;
  deploymentIds: string[];
  production: boolean;
  maxAgeMinutes?: number;
  expectedHostProfile?: string;
  operation?: string;
};

export type RuntimeSourceRecord = {
  id: string;
  source?: DeploymentResourceSource;
  refs?: string[];
  value: unknown;
  validation?: RuntimeValidationOptions & Record<string, unknown>;
};

export type RuntimeStatusRecord = {
  id: string;
  source?: DeploymentResourceSource;
  refs?: string[];
  facts: Record<string, unknown>;
};

export type ServiceClientSelectionRecord = {
  id: string;
  source:
    | "context"
    | "explicit_override"
    | "explicit"
    | "ambient"
    | "remote"
    | "profile"
    | "profile_root"
    | "lane_policy_default"
    | "token_env";
  status: "resolved" | "rejected";
  controlPlaneUrl?: string;
  controlPlaneName?: string;
  controlPlaneTokenRef?: string;
  profileName?: string;
  profileRoot?: string;
  tokenEnv?: string;
  defaultedFromLanePolicy?: boolean;
  diagnostic?: string;
  refs?: string[];
};

export type DeploymentRuntimeInventorySources = {
  runtimeInputs?: RuntimeSourceRecord[];
  authProviderProfiles?: RuntimeSourceRecord[];
  readinessEvidence?: RuntimeSourceRecord[];
  observabilityEvidence?: RuntimeSourceRecord[];
  miniMigrationEvidence?: RuntimeSourceRecord[];
  artifactChallenges?: RuntimeStatusRecord[];
  staticWebappUploadSessions?: RuntimeStatusRecord[];
  artifactBindingProvenance?: RuntimeStatusRecord[];
  cleanupEvidence?: RuntimeStatusRecord[];
  artifactCleanupJanitorRecords?: RuntimeStatusRecord[];
  executionSnapshots?: RuntimeStatusRecord[];
  deployRuns?: RuntimeStatusRecord[];
  runActions?: RuntimeStatusRecord[];
  currentStageStates?: RuntimeStatusRecord[];
  stageHistoryEntries?: RuntimeStatusRecord[];
  auditEvents?: RuntimeStatusRecord[];
  retainedEvidence?: RuntimeStatusRecord[];
  controlPlaneRuntime?: RuntimeStatusRecord[];
  serviceClientSelections?: ServiceClientSelectionRecord[];
};

export type DeploymentResourceInventoryOptions = {
  workspaceRoot?: string;
  graphPath?: string;
  runtimeSources?: DeploymentRuntimeInventorySources;
};

export type DeploymentResourceInventory = {
  taxonomyVersion: "deployment-resource-taxonomy@1";
  resources: DeploymentResourceInventoryEntry[];
  errors: string[];
  graphRead: {
    providerIndexAvailable: boolean;
    nodeLockIndexAvailable: boolean;
  };
  workspace: {
    supportedDeploymentQueryRoots: readonly string[];
    projectConfig: {
      sharedPath: string;
      localPath: string;
      localPresent: boolean;
      disallowLocalOverrides: boolean;
      redactedOverrides: Array<Record<string, unknown>>;
    };
  };
};
