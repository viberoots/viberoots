#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import { maybeHandleDeploymentAdminCli } from "./deployment-admin-keycloak-cli";
import { maybeHandleDeploymentAuthCli } from "./deployment-auth-diagnostics";
import { hasAdmitOnlyFlag, resolveDeploymentAdmissionEvidence } from "./deployment-admission-cli";
import { resolveDeploymentForCli } from "./deployment-cli-resolve";
import {
  assertDeployCliReadonlyGuardrails,
  maybeHandleReadonlyDeployCli,
  readDeployCliReadonlyFlags,
} from "./deploy-cli-readonly";
import { listDeploymentsForCli, printDeployJson } from "./deploy-front-door";
import { DEPLOY_CLI_USAGE } from "./deploy-cli-usage";
import { resolveSmokeConnectOverride } from "./deployment-cli-smoke";
import {
  cleanupDeploymentSecretRuntime,
  prepareDeploymentSecretRuntime,
} from "./deployment-secret-runtime-prepare";
import { activateDeploymentSecretContext } from "./deployment-secret-context";
import { assertNoProtectedSharedClientCredentialInputs } from "./deployment-service-client-contract";
import {
  type DeploymentTarget,
  isCloudflarePagesDeployment,
  isKubernetesDeployment,
  isNixosSharedHostDeployment,
  isVercelDeployment,
} from "./contract";
import { runProviderDeployFrontDoor } from "./deploy-cli-provider-dispatch";
import { maybeRunProviderCapabilityHookForCli } from "./deploy-cli-provider-capability";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

export async function runDeployCli(opts: {
  workspaceRoot: string;
  publicFrontDoor: boolean;
  deploymentJsonErrorMessage: string;
}) {
  if (getFlagBool("help")) {
    console.log(DEPLOY_CLI_USAGE);
    return;
  }
  if (hasFlag("deployment-json")) throw new Error(opts.deploymentJsonErrorMessage);
  if (await maybeHandleDeploymentAdminCli(opts.workspaceRoot)) return;
  if (await maybeHandleDeploymentAuthCli(opts.workspaceRoot)) return;
  if (getFlagBool("from-changes")) {
    const { runFromChangesCli } = await import("./deployment-from-changes-cli");
    await runFromChangesCli(opts.workspaceRoot);
    return;
  }
  if (getFlagBool("list")) {
    if (
      [
        "print-target-identity",
        "print-vault-bootstrap",
        "print-vault-secret-templates",
        "validate-only",
        "provision-only",
        "publish-only",
        "preview",
        "preview-cleanup",
        "remove",
        "rollback",
      ].some((flag) => getFlagBool(flag))
    ) {
      throw new Error("--list cannot be combined with deploy mutation or validation flags");
    }
    printDeployJson(await listDeploymentsForCli(opts.workspaceRoot));
    return;
  }
  const deployment = await resolveDeploymentForCli(opts.workspaceRoot, requireFlag, {
    deploymentJsonErrorMessage: opts.deploymentJsonErrorMessage,
  });
  const flags = readDeployCliReadonlyFlags();
  const admissionEvidence = await resolveDeploymentAdmissionEvidence({
    deployment,
    workspaceRoot: opts.workspaceRoot,
  });
  const smokeConnectOverride = resolveSmokeConnectOverride();
  if (hasAdmitOnlyFlag()) {
    if (!admissionEvidence) throw new Error("--admit-only did not produce admission evidence");
    printDeployJson(admissionEvidence);
    return;
  }
  assertDeployCliReadonlyGuardrails(flags);
  if (
    await maybeHandleReadonlyDeployCli({ workspaceRoot: opts.workspaceRoot, deployment, flags })
  ) {
    return;
  }
  assertNoProtectedSharedClientCredentialInputs({
    deployment,
    publicFrontDoor: opts.publicFrontDoor,
    vaultRuntimeInputs: flags.vaultRuntimeInputs,
  });
  if (await maybeRunProviderCapabilityHookForCli({ deployment })) return;
  if (flags.preview && flags.previewCleanup) {
    throw new Error("--preview and --preview-cleanup are mutually exclusive");
  }
  if (flags.retireTarget && flags.migrateTarget) {
    throw new Error("--retire-target and --migrate-target are mutually exclusive");
  }
  if (flags.preview && (flags.publishOnly || flags.remove || flags.rollback)) {
    throw new Error("--preview cannot be combined with --publish-only, --remove, or --rollback");
  }
  if (flags.previewCleanup && (flags.publishOnly || flags.remove || flags.rollback)) {
    throw new Error(
      "--preview-cleanup cannot be combined with --publish-only, --remove, or --rollback",
    );
  }
  if (
    (flags.retireTarget || flags.migrateTarget) &&
    (flags.publishOnly || flags.remove || flags.preview || flags.previewCleanup)
  ) {
    throw new Error(
      "--retire-target/--migrate-target cannot be combined with deploy, publish-only, remove, or preview flags",
    );
  }
  const skipSecretRuntime = shouldSkipSecretRuntime(deployment, opts.publicFrontDoor);
  const secretRuntime = skipSecretRuntime
    ? { minted: false }
    : await prepareDeploymentSecretRuntime({
        workspaceRoot: opts.workspaceRoot,
        deployment,
        inputs: flags.vaultRuntimeInputs,
      });
  const restoreSecretContext = activateDeploymentSecretContext(secretRuntime.secretContext);
  try {
    await runProviderDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      publicFrontDoor: opts.publicFrontDoor,
      deployment,
      flags,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      hasFlag,
    });
  } finally {
    restoreSecretContext();
    await cleanupDeploymentSecretRuntime(secretRuntime);
  }
}

export function usesServiceBackedWorkerRuntime(
  deployment: DeploymentTarget,
  publicFrontDoor: boolean,
) {
  return (
    publicFrontDoor &&
    deployment.protectionClass !== "local_only" &&
    (isNixosSharedHostDeployment(deployment) ||
      isCloudflarePagesDeployment(deployment) ||
      isKubernetesDeployment(deployment) ||
      isVercelDeployment(deployment))
  );
}

function shouldSkipSecretRuntime(deployment: DeploymentTarget, publicFrontDoor: boolean) {
  return (
    usesServiceBackedWorkerRuntime(deployment, publicFrontDoor) &&
    !deployment.controlPlane?.serviceClient.controlPlaneTokenRef.startsWith("secret://")
  );
}
