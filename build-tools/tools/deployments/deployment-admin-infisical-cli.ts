#!/usr/bin/env zx-wrapper
import { printDeployJson } from "./deploy-front-door";
import {
  buildDeploymentAdminInfisicalPlan,
  checkDeploymentAdminInfisical,
} from "./deployment-admin-infisical";
import type { DeploymentTarget } from "./contract";

export async function handleDeploymentAdminInfisicalCli(opts: {
  command: string;
  deployment: DeploymentTarget;
}): Promise<boolean> {
  if (opts.command === "plan") {
    printDeployJson(buildDeploymentAdminInfisicalPlan(opts.deployment));
    return true;
  }
  if (opts.command === "check") {
    const result = await checkDeploymentAdminInfisical({ deployment: opts.deployment });
    printDeployJson(result);
    if (!result.inSync) process.exitCode = 1;
    return true;
  }
  throw new Error("deploy admin infisical command must be one of plan, check");
}
