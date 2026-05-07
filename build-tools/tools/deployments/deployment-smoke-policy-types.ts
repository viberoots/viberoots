#!/usr/bin/env zx-wrapper
import type { DeploymentDefaultSmokeClass } from "./deployment-component-kinds";

export type DeploymentSmokeException = {
  owner: string;
  reason: string;
  scope: string;
  reviewBy?: string;
  expiresAt?: string;
  downgradeMode?: string;
};

export type DeploymentSmokePolicy = {
  exception?: DeploymentSmokeException;
  runner?: string;
  url?: string;
  path?: string;
  expectedStatus?: string;
  runnerClass?: DeploymentDefaultSmokeClass;
  timeoutBudgetMs?: number;
};

export type DeploymentSmokeExecutionMode = "blocking" | "nonblocking" | "omitted";
export type DeploymentSmokeOutcome = "passed" | "failed_nonblocking" | "omitted_by_exception";
