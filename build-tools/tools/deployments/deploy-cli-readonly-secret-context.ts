#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import type { DeployCliReadonlyFlags } from "./deploy-cli-flags";
import { activateDeploymentSecretContext } from "./deployment-secret-context";
import {
  cleanupDeploymentSecretRuntime,
  prepareDeploymentSecretRuntime,
} from "./deployment-secret-runtime-prepare";

export async function withReadonlySecretContext<T>(
  opts: {
    workspaceRoot: string;
    deployment: DeploymentTarget;
    flags: DeployCliReadonlyFlags;
  },
  run: () => Promise<T>,
) {
  if (!needsReadonlySecretContext(opts)) return await run();
  const runtime = await prepareDeploymentSecretRuntime({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    inputs: opts.flags.vaultRuntimeInputs,
  });
  const restore = activateDeploymentSecretContext(runtime.secretContext);
  try {
    return await run();
  } finally {
    restore();
    await cleanupDeploymentSecretRuntime(runtime);
  }
}

function needsReadonlySecretContext(opts: {
  deployment: DeploymentTarget;
  flags: DeployCliReadonlyFlags;
}) {
  if (!opts.deployment.controlPlane?.serviceClient.controlPlaneTokenRef.startsWith("secret://")) {
    return false;
  }
  if (opts.flags.controlPlaneOperatorAction) return true;
  return (
    (opts.flags.printVaultBootstrap || opts.flags.printVaultSecretTemplates) &&
    Boolean(getFlagStr("deploy-run-id", "").trim())
  );
}
