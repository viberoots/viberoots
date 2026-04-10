#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type {
  DeploymentComponentKind,
  DeploymentDefaultSmokeClass,
} from "./deployment-component-kinds.ts";
import type { DeploymentTarget } from "./contract-types.ts";
import {
  DEPLOYMENT_SMOKE_CLASSES,
  resolveDeploymentSmokeBudget,
  type DeploymentSmokeBudget,
} from "./deployment-smoke-budget.ts";

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
  runnerClass?: DeploymentDefaultSmokeClass;
  timeoutBudgetMs?: number;
};

export type DeploymentSmokeExecutionMode = "blocking" | "nonblocking" | "omitted";
export type DeploymentSmokeOutcome = "passed" | "failed_nonblocking" | "omitted_by_exception";

const PROTECTED_SMOKE_CLASSES = new Set(["shared_nonprod", "production_facing"]);

function deploymentError(label: string, message: string): string {
  return `${label}: ${message}`;
}

function readStringRecord(node: GraphNode, key: string): Record<string, string> {
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "string",
      )
      .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
      .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
  );
}

function parseSmokeException(
  smokeException: Record<string, string>,
): DeploymentSmokeException | undefined {
  if (Object.keys(smokeException).length === 0) return undefined;
  return {
    owner: smokeException.owner || "",
    reason: smokeException.reason || "",
    scope: smokeException.scope || "",
    ...(smokeException.review_by ? { reviewBy: smokeException.review_by } : {}),
    ...(smokeException.expires_at ? { expiresAt: smokeException.expires_at } : {}),
    ...(smokeException.downgrade_mode ? { downgradeMode: smokeException.downgrade_mode } : {}),
  };
}

function parsedDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSmokeTimeoutBudget(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) ? value : Number.NaN;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function exceptionTargetsPreviewOnly(scope: string): boolean {
  return scope.toLowerCase().includes("preview");
}

function exceptionRequestsOmit(scope: string): boolean {
  return scope.toLowerCase().includes("omit");
}

function exceptionRequestsDowngrade(scope: string): boolean {
  return scope.toLowerCase().includes("downgrade");
}

function isProtectedSmokeClass(protectionClass: string): boolean {
  return PROTECTED_SMOKE_CLASSES.has(protectionClass);
}

export function readDeploymentSmokePolicy(node: GraphNode): DeploymentSmokePolicy | undefined {
  const smokeException = parseSmokeException(readStringRecord(node, "smoke_exception"));
  const runnerClass = String(node.smoke_runner_class || "").trim() as DeploymentDefaultSmokeClass;
  const timeoutBudgetMs = parseSmokeTimeoutBudget(node.smoke_timeout_budget_ms);
  if (!smokeException && !runnerClass && timeoutBudgetMs === undefined) return undefined;
  return {
    ...(smokeException ? { exception: smokeException } : {}),
    ...(runnerClass ? { runnerClass } : {}),
    ...(timeoutBudgetMs !== undefined ? { timeoutBudgetMs } : {}),
  };
}

export function pushSmokePolicyErrors(opts: {
  label: string;
  protectionClass: string;
  componentKind?: DeploymentComponentKind;
  smoke?: DeploymentSmokePolicy;
  errors: string[];
  now?: Date;
}) {
  const exception = opts.smoke?.exception;
  if (
    opts.smoke?.runnerClass &&
    !DEPLOYMENT_SMOKE_CLASSES.has(opts.smoke.runnerClass as DeploymentDefaultSmokeClass)
  ) {
    opts.errors.push(
      deploymentError(opts.label, `unsupported smoke.runnerClass "${opts.smoke.runnerClass}"`),
    );
  }
  if (
    opts.smoke?.timeoutBudgetMs !== undefined &&
    (!Number.isInteger(opts.smoke.timeoutBudgetMs) || opts.smoke.timeoutBudgetMs <= 0)
  ) {
    opts.errors.push(
      deploymentError(opts.label, "smoke.timeoutBudgetMs must be a positive integer"),
    );
  }
  if (
    opts.componentKind &&
    opts.smoke?.runnerClass === "release_health" &&
    opts.componentKind !== "mobile-app"
  ) {
    opts.errors.push(
      deploymentError(
        opts.label,
        "smoke.runnerClass release_health is reviewed only for mobile-app deployments",
      ),
    );
  }
  if (!exception) return;
  if (!exception.owner) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.owner is required"));
  }
  if (!exception.reason) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.reason is required"));
  }
  if (!exception.scope) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.scope is required"));
  }
  if (!exception.reviewBy && !exception.expiresAt) {
    opts.errors.push(
      deploymentError(opts.label, "smoke.exception must define review_by or expires_at"),
    );
  }
  if (
    exception.scope &&
    !exceptionRequestsOmit(exception.scope) &&
    !exceptionRequestsDowngrade(exception.scope)
  ) {
    opts.errors.push(
      deploymentError(
        opts.label,
        "smoke.exception.scope must request omit or downgrade behavior explicitly",
      ),
    );
  }
  if (exception.reviewBy && parsedDate(exception.reviewBy) === undefined) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.review_by must be a valid date"));
  }
  if (exception.expiresAt && parsedDate(exception.expiresAt) === undefined) {
    opts.errors.push(
      deploymentError(opts.label, "smoke.exception.expires_at must be a valid date"),
    );
  }
  const now = (opts.now || new Date()).getTime();
  const reviewBy = parsedDate(exception.reviewBy);
  if (reviewBy !== undefined && reviewBy < now) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.review_by is no longer valid"));
  }
  const expiresAt = parsedDate(exception.expiresAt);
  if (expiresAt !== undefined && expiresAt < now) {
    opts.errors.push(deploymentError(opts.label, "smoke.exception.expires_at is no longer valid"));
  }
  if (!isProtectedSmokeClass(opts.protectionClass)) return;
}

export function resolveDeploymentSmokeExecutionMode(opts: {
  deployment: Pick<DeploymentTarget, "label" | "protectionClass" | "component" | "smoke">;
  publishMode?: "normal" | "preview";
  now?: Date;
}): {
  mode: DeploymentSmokeExecutionMode;
  smokeException?: DeploymentSmokeException;
  budget: DeploymentSmokeBudget;
} {
  const budget = resolveDeploymentSmokeBudget({
    componentKind: opts.deployment.component.kind,
    smoke: opts.deployment.smoke,
  });
  if (!isProtectedSmokeClass(opts.deployment.protectionClass)) {
    return { mode: "blocking", budget };
  }
  const exception = opts.deployment.smoke?.exception;
  if (!exception) return { mode: "blocking", budget };
  const validationErrors: string[] = [];
  pushSmokePolicyErrors({
    label: opts.deployment.label,
    protectionClass: opts.deployment.protectionClass,
    componentKind: opts.deployment.component.kind,
    smoke: opts.deployment.smoke,
    errors: validationErrors,
    now: opts.now,
  });
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("\n"));
  }
  if (
    (opts.publishMode || "normal") !== "preview" &&
    exceptionTargetsPreviewOnly(exception.scope)
  ) {
    return { mode: "blocking", budget };
  }
  if (exceptionRequestsOmit(exception.scope)) {
    return { mode: "omitted", smokeException: exception, budget };
  }
  if (exceptionRequestsDowngrade(exception.scope)) {
    return { mode: "nonblocking", smokeException: exception, budget };
  }
  return { mode: "blocking", budget };
}
