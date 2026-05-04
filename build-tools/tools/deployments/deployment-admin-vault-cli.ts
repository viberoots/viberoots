#!/usr/bin/env zx-wrapper
import { printDeployJson } from "./deploy-front-door";
import {
  buildDeploymentAdminVaultPlan,
  checkDeploymentAdminVault,
  syncDeploymentAdminVault,
} from "./deployment-admin-vault";
import type { DeploymentTarget } from "./contract";

export async function handleDeploymentAdminVaultCli(opts: {
  command: string;
  deployment: DeploymentTarget;
}): Promise<boolean> {
  if (opts.command === "plan") {
    printDeployJson(buildDeploymentAdminVaultPlan(opts.deployment));
    return true;
  }
  if (opts.command === "check") {
    const result = await checkDeploymentAdminVault({ deployment: opts.deployment });
    printDeployJson(result);
    if (!result.inSync) process.exitCode = 1;
    return true;
  }
  if (opts.command === "sync") {
    printDeployJson(await syncDeploymentAdminVault({ deployment: opts.deployment }));
    return true;
  }
  throw new Error("deploy admin vault command must be one of plan, check, sync");
}
