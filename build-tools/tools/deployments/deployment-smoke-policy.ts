#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type { DeploymentTarget } from "./contract-types.ts";

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
  return smokeException ? { exception: smokeException } : undefined;
}

export function pushSmokePolicyErrors(opts: {
  label: string;
  protectionClass: string;
  smoke?: DeploymentSmokePolicy;
  errors: string[];
  now?: Date;
}) {
  const exception = opts.smoke?.exception;
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
  deployment: Pick<DeploymentTarget, "label" | "protectionClass" | "smoke">;
  publishMode?: "normal" | "preview";
  now?: Date;
}): {
  mode: DeploymentSmokeExecutionMode;
  smokeException?: DeploymentSmokeException;
} {
  if (!isProtectedSmokeClass(opts.deployment.protectionClass)) {
    return { mode: "blocking" };
  }
  const exception = opts.deployment.smoke?.exception;
  if (!exception) return { mode: "blocking" };
  const validationErrors: string[] = [];
  pushSmokePolicyErrors({
    label: opts.deployment.label,
    protectionClass: opts.deployment.protectionClass,
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
    return { mode: "blocking" };
  }
  if (exceptionRequestsOmit(exception.scope)) {
    return { mode: "omitted", smokeException: exception };
  }
  if (exceptionRequestsDowngrade(exception.scope)) {
    return { mode: "nonblocking", smokeException: exception };
  }
  return { mode: "blocking" };
}
