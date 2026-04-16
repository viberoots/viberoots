#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import {
  maybeRunDeployControlPlaneOperatorCommand,
  selectedDeployControlPlaneOperatorAction,
  type DeployControlPlaneOperatorAction,
} from "./deploy-control-plane-operator.ts";
import {
  printDeployJson,
  printProviderTargetIdentityForCli,
  validateDeploymentForCli,
} from "./deploy-front-door.ts";

export type DeployCliReadonlyFlags = {
  printTargetIdentity: boolean;
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
  if (flags.printTargetIdentity && (flags.validateOnly || hasMutatingOrPreviewFlags(flags))) {
    throw new Error(
      "--print-target-identity cannot be combined with validation, mutation, preview, or target-transition flags",
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
  return await maybeRunDeployControlPlaneOperatorCommand({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
  });
}
