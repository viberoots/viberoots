#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";

export const DEPLOYMENT_TARGET_EXCEPTION_RULE = "deployment_target_exception";

export type DeploymentTargetException = {
  ref: string;
  exceptionId: string;
  exceptionKind: "migration" | "alias";
  affectedDeploymentIds: string[];
  oldProviderTargetIdentity: string;
  newProviderTargetIdentity?: string;
  sharedLockScope: string;
  approvalEvidence: string;
  effectiveAt: string;
  expiresAt?: string;
  completionSignal?: string;
  reconciliationOwner: string;
};

function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

function readStringArray(node: GraphNode, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function exceptionError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function extractDeploymentTargetExceptions(nodes: GraphNode[]): {
  exceptions: Map<string, DeploymentTargetException>;
  errors: string[];
} {
  const exceptions = new Map<string, DeploymentTargetException>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_TARGET_EXCEPTION_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const exception: DeploymentTargetException = {
      ref,
      exceptionId: readString(node, "exception_id") || ref,
      exceptionKind: readString(
        node,
        "exception_kind",
      ) as DeploymentTargetException["exceptionKind"],
      affectedDeploymentIds: readStringArray(node, "affected_deployments"),
      oldProviderTargetIdentity: readString(node, "old_provider_target_identity"),
      ...(readString(node, "new_provider_target_identity")
        ? { newProviderTargetIdentity: readString(node, "new_provider_target_identity") }
        : {}),
      sharedLockScope: readString(node, "shared_lock_scope"),
      approvalEvidence: readString(node, "approval_evidence"),
      effectiveAt: readString(node, "effective_at"),
      ...(readString(node, "expires_at") ? { expiresAt: readString(node, "expires_at") } : {}),
      ...(readString(node, "completion_signal")
        ? { completionSignal: readString(node, "completion_signal") }
        : {}),
      reconciliationOwner: readString(node, "reconciliation_owner"),
    };
    if (!ref) {
      errors.push("deployment target exception missing canonical label");
      continue;
    }
    if (exception.exceptionKind !== "migration" && exception.exceptionKind !== "alias") {
      errors.push(
        exceptionError(ref, `unsupported exception_kind "${exception.exceptionKind || "<empty>"}"`),
      );
    }
    if (exception.exceptionKind === "migration" && !exception.newProviderTargetIdentity) {
      errors.push(
        exceptionError(ref, "migration target exception must define new_provider_target_identity"),
      );
    }
    if (exception.affectedDeploymentIds.length === 0) {
      errors.push(exceptionError(ref, "target exception must define affected_deployments"));
    }
    if (!exception.oldProviderTargetIdentity) {
      errors.push(exceptionError(ref, "target exception must define old_provider_target_identity"));
    }
    if (!exception.sharedLockScope) {
      errors.push(exceptionError(ref, "target exception must define shared_lock_scope"));
    }
    if (!exception.approvalEvidence) {
      errors.push(exceptionError(ref, "target exception must define approval_evidence"));
    }
    if (!exception.effectiveAt) {
      errors.push(exceptionError(ref, "target exception must define effective_at"));
    }
    if (!exception.expiresAt && !exception.completionSignal) {
      errors.push(
        exceptionError(ref, "target exception must define expires_at or completion_signal"),
      );
    }
    if (!exception.reconciliationOwner) {
      errors.push(exceptionError(ref, "target exception must define reconciliation_owner"));
    }
    if (errors.some((entry) => entry.startsWith(`${ref}:`))) continue;
    exceptions.set(ref, exception);
  }
  return { exceptions, errors };
}

export function isTargetExceptionActive(
  exception: DeploymentTargetException,
  at = new Date(),
): boolean {
  const effectiveAt = Date.parse(exception.effectiveAt);
  if (!Number.isFinite(effectiveAt) || effectiveAt > at.getTime()) return false;
  if (!exception.expiresAt) return true;
  const expiresAt = Date.parse(exception.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt >= at.getTime();
}

export function allowsSharedTargetTransition(
  exception: DeploymentTargetException,
  deploymentIds: string[],
  providerTargetIdentity: string,
  at = new Date(),
): boolean {
  if (!isTargetExceptionActive(exception, at) || exception.exceptionKind !== "alias") return false;
  if (exception.oldProviderTargetIdentity !== providerTargetIdentity) return false;
  return deploymentIds.every((deploymentId) =>
    exception.affectedDeploymentIds.includes(deploymentId),
  );
}

export function invalidatingTargetException(
  exceptions: DeploymentTargetException[],
  sourceTargetIdentity: string,
  currentTargetIdentity: string,
  at = new Date(),
): DeploymentTargetException | undefined {
  return exceptions.find(
    (exception) =>
      isTargetExceptionActive(exception, at) &&
      exception.oldProviderTargetIdentity === sourceTargetIdentity &&
      !!exception.newProviderTargetIdentity &&
      exception.newProviderTargetIdentity === currentTargetIdentity,
  );
}
