#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import {
  selectedDeployControlPlaneOperatorAction,
  type DeployControlPlaneOperatorAction,
} from "./deploy-control-plane-operator-flags.ts";
import {
  printDeployJson,
  printProviderTargetIdentityForCli,
  validateDeploymentForCli,
} from "./deploy-front-door.ts";
import {
  assertVaultBootstrapExecutableInputs,
  buildVaultBootstrapDocument,
  buildVaultSecretTemplatesDocument,
  renderVaultBootstrapDocument,
  renderVaultSecretTemplatesDocument,
  type VaultBootstrapFormat,
  type VaultBootstrapInputs,
  type VaultSecretTemplateFormat,
} from "./deployment-vault-bootstrap.ts";
export type DeployCliReadonlyFlags = {
  printTargetIdentity: boolean;
  printVaultBootstrap: boolean;
  printVaultSecretTemplates: boolean;
  vaultBootstrapFormat: VaultBootstrapFormat;
  vaultSecretTemplateFormat: VaultSecretTemplateFormat;
  vaultBootstrapInputs: VaultBootstrapInputs;
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
};
export function readDeployCliReadonlyFlags(): DeployCliReadonlyFlags {
  return {
    printTargetIdentity: getFlagBool("print-target-identity"),
    printVaultBootstrap: getFlagBool("print-vault-bootstrap"),
    printVaultSecretTemplates: getFlagBool("print-vault-secret-templates"),
    vaultBootstrapFormat: readBootstrapFormat(),
    vaultSecretTemplateFormat: readSecretTemplateFormat(),
    vaultBootstrapInputs: {
      issuerUrl: getFlagStr("issuer-url", "").trim() || undefined,
      audience: getFlagStr("vault-audience", "").trim() || undefined,
      deploymentClientId: getFlagStr("deployment-client-id", "").trim() || undefined,
      roleName: getFlagStr("vault-jwt-role", "").trim() || undefined,
      policyName: getFlagStr("vault-policy-name", "").trim() || undefined,
      extraBoundClaims: readExtraBoundClaims(),
    },
    validateOnly: getFlagBool("validate-only"),
    controlPlaneOperatorAction: selectedDeployControlPlaneOperatorAction(),
    remove: getFlagBool("remove"),
    provisionOnly: getFlagBool("provision-only"),
    publishOnly: getFlagBool("publish-only"),
    preview: getFlagBool("preview"),
    previewCleanup: getFlagBool("preview-cleanup"),
    rollback: getFlagBool("rollback"),
    retireTarget: getFlagBool("retire-target"),
    migrateTarget: getFlagBool("migrate-target"),
    targetExceptionRef: getFlagStr("target-exception-ref", "").trim(),
    cleanupReason: getFlagStr("cleanup-reason", "manual_cleanup").trim(),
    sourceRunId: getFlagStr("source-run-id", "").trim(),
    artifactDirFlag: getFlagStr("artifact-dir", "").trim(),
  };
}
function readBootstrapFormat(): VaultBootstrapFormat {
  const value = getFlagStr("vault-bootstrap-format", "json").trim();
  if (["json", "shell", "hcl", "markdown"].includes(value)) return value as VaultBootstrapFormat;
  throw new Error("--vault-bootstrap-format must be one of json, shell, hcl, markdown");
}
function readSecretTemplateFormat(): VaultSecretTemplateFormat {
  const value = getFlagStr("vault-secret-template-format", "json").trim();
  if (["json", "files"].includes(value)) return value as VaultSecretTemplateFormat;
  throw new Error("--vault-secret-template-format must be one of json, files");
}
function readExtraBoundClaims(): Record<string, string> | undefined {
  const entries = getFlagList("vault-bound-claim");
  if (entries.length === 0) return undefined;
  const claims: Record<string, string> = {};
  for (const entry of entries) {
    const [key = "", ...rest] = entry.split("=");
    const value = rest.join("=").trim();
    if (!key.trim() || !value) throw new Error("--vault-bound-claim entries must use key=value");
    claims[key.trim()] = value;
  }
  return claims;
}
function hasMutatingOrPreviewFlags(flags: DeployCliReadonlyFlags) {
  return (
    flags.provisionOnly ||
    flags.publishOnly ||
    flags.preview ||
    flags.previewCleanup ||
    flags.remove ||
    flags.rollback ||
    flags.retireTarget ||
    flags.migrateTarget
  );
}
export function assertDeployCliReadonlyGuardrails(flags: DeployCliReadonlyFlags) {
  if (flags.printVaultBootstrap && flags.printVaultSecretTemplates) {
    throw new Error(
      "--print-vault-bootstrap and --print-vault-secret-templates are mutually exclusive",
    );
  }
  if (flags.controlPlaneOperatorAction && (flags.printTargetIdentity || flags.validateOnly)) {
    throw new Error(
      `--${flags.controlPlaneOperatorAction} cannot be combined with validation, mutation, preview, or target-transition flags`,
    );
  }
  if (flags.controlPlaneOperatorAction && hasMutatingOrPreviewFlags(flags)) {
    throw new Error(
      `--${flags.controlPlaneOperatorAction} cannot be combined with validation, mutation, preview, or target-transition flags`,
    );
  }
  if (
    flags.controlPlaneOperatorAction &&
    (flags.printVaultBootstrap || flags.printVaultSecretTemplates)
  ) {
    throw new Error(
      `--${flags.controlPlaneOperatorAction} cannot be combined with Vault bootstrap helpers`,
    );
  }
  if (flags.printTargetIdentity && (flags.validateOnly || hasMutatingOrPreviewFlags(flags))) {
    throw new Error(
      "--print-target-identity cannot be combined with validation, mutation, preview, or target-transition flags",
    );
  }
  if (
    (flags.printVaultBootstrap || flags.printVaultSecretTemplates) &&
    (flags.validateOnly || flags.printTargetIdentity || hasMutatingOrPreviewFlags(flags))
  ) {
    throw new Error(
      "Vault bootstrap helpers cannot be combined with validation, mutation, preview, rollback, or target-transition flags",
    );
  }
  if (
    flags.validateOnly &&
    (flags.provisionOnly ||
      flags.publishOnly ||
      flags.preview ||
      flags.previewCleanup ||
      flags.remove ||
      flags.rollback)
  ) {
    throw new Error(
      "--validate-only cannot be combined with mutating, preview, or publish-only flags",
    );
  }
  if (
    flags.provisionOnly &&
    (flags.publishOnly || flags.preview || flags.previewCleanup || flags.remove || flags.rollback)
  ) {
    throw new Error(
      "--provision-only cannot be combined with --publish-only, preview, remove, or rollback",
    );
  }
}
async function targetScopeForReadonlyVaultHelper(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
}) {
  const deployRunId = getFlagStr("deploy-run-id", "").trim();
  if (!deployRunId) return undefined;
  const { readStatusForOperator, resolveServiceClientForOperator } = await import(
    "./deploy-control-plane-operator-client.ts"
  );
  const client = await resolveServiceClientForOperator({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    actionLabel: "deploy --print-vault-bootstrap",
  });
  const status = await readStatusForOperator({
    controlPlaneUrl: client.controlPlaneUrl,
    ...(client.controlPlaneToken ? { controlPlaneToken: client.controlPlaneToken } : {}),
    selector: { deployRunId },
  });
  return { value: status.lockScope, source: "deploy-run-lock-scope" as const };
}
export async function maybeHandleReadonlyDeployCli(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  flags: DeployCliReadonlyFlags;
}) {
  if (opts.flags.validateOnly) {
    printDeployJson(await validateDeploymentForCli(opts.workspaceRoot, opts.deployment));
    return true;
  }
  if (opts.flags.printTargetIdentity) {
    printProviderTargetIdentityForCli(opts.deployment);
    return true;
  }
  if (opts.flags.printVaultBootstrap) {
    if (opts.flags.vaultBootstrapFormat !== "json") {
      assertVaultBootstrapExecutableInputs(opts.flags.vaultBootstrapInputs);
    }
    const targetScope = await targetScopeForReadonlyVaultHelper(opts);
    console.log(
      renderVaultBootstrapDocument(
        buildVaultBootstrapDocument({
          deployment: opts.deployment,
          inputs: opts.flags.vaultBootstrapInputs,
          ...(targetScope ? { targetScope } : {}),
        }),
        opts.flags.vaultBootstrapFormat,
      ),
    );
    return true;
  }
  if (opts.flags.printVaultSecretTemplates) {
    const targetScope = await targetScopeForReadonlyVaultHelper(opts);
    console.log(
      renderVaultSecretTemplatesDocument(
        buildVaultSecretTemplatesDocument({
          deployment: opts.deployment,
          ...(targetScope ? { targetScope } : {}),
        }),
        opts.flags.vaultSecretTemplateFormat,
      ),
    );
    return true;
  }
  const { maybeRunDeployControlPlaneOperatorCommand } = await import(
    "./deploy-control-plane-operator.ts"
  );
  return await maybeRunDeployControlPlaneOperatorCommand({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
  });
}
