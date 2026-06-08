#!/usr/bin/env zx-wrapper
import type { DeployControlPlaneOperatorAction } from "./deploy-control-plane-operator-flags";
import type {
  VaultBootstrapFormat,
  VaultBootstrapInputs,
  VaultSecretTemplateFormat,
} from "./deployment-vault-bootstrap";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime";

export type DeployCliReadonlyFlags = {
  printTargetIdentity: boolean;
  printVaultBootstrap: boolean;
  printVaultSecretTemplates: boolean;
  vaultBootstrapFormat: VaultBootstrapFormat;
  vaultSecretTemplateFormat: VaultSecretTemplateFormat;
  vaultBootstrapInputs: VaultBootstrapInputs;
  vaultRuntimeInputs: DeploymentVaultRuntimeInputs;
  validateOnly: boolean;
  controlPlaneOperatorAction?: DeployControlPlaneOperatorAction;
  remove: boolean;
  provisionOnly: boolean;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  retireTarget: boolean;
  migrateTarget: boolean;
  targetExceptionRef: string;
  cleanupReason: string;
  sourceRunId: string;
  artifactDirFlag: string;
  controlPlaneDatabaseUrl: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  remote: string;
  allowControlPlaneOverride: boolean;
};
