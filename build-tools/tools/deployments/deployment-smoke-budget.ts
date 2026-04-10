#!/usr/bin/env zx-wrapper
import type {
  DeploymentComponentKind,
  DeploymentDefaultSmokeClass,
} from "./deployment-component-kinds.ts";
import { defaultSmokeClassForComponentKind } from "./deployment-component-kinds.ts";
import type { DeploymentSmokePolicy } from "./deployment-smoke-policy.ts";

export type DeploymentSmokeBudgetSource =
  | "component_kind_default"
  | "deployment_metadata.runner_class"
  | "deployment_metadata.timeout_budget_ms";

export type DeploymentSmokeBudget = {
  runnerClass: DeploymentDefaultSmokeClass;
  totalBudgetMs?: number;
  source: DeploymentSmokeBudgetSource;
};

export const DEPLOYMENT_SMOKE_CLASSES = new Set<DeploymentDefaultSmokeClass>([
  "http_5m",
  "http_10m",
  "release_health",
  "service_health_10m",
]);

const SMOKE_CLASS_BUDGETS_MS: Partial<Record<DeploymentDefaultSmokeClass, number>> = {
  http_5m: 5 * 60 * 1000,
  http_10m: 10 * 60 * 1000,
  service_health_10m: 10 * 60 * 1000,
};

export function resolveDeploymentSmokeBudget(opts: {
  componentKind: DeploymentComponentKind;
  smoke?: DeploymentSmokePolicy;
}): DeploymentSmokeBudget {
  const runnerClass =
    opts.smoke?.runnerClass || defaultSmokeClassForComponentKind(opts.componentKind);
  if (opts.smoke?.timeoutBudgetMs !== undefined) {
    return {
      runnerClass,
      totalBudgetMs: opts.smoke.timeoutBudgetMs,
      source: "deployment_metadata.timeout_budget_ms",
    };
  }
  if (opts.smoke?.runnerClass) {
    return {
      runnerClass,
      totalBudgetMs: SMOKE_CLASS_BUDGETS_MS[runnerClass],
      source: "deployment_metadata.runner_class",
    };
  }
  return {
    runnerClass,
    totalBudgetMs: SMOKE_CLASS_BUDGETS_MS[runnerClass],
    source: "component_kind_default",
  };
}
