#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client.ts";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs.ts";
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneStatus,
} from "./deployment-control-plane-contract.ts";
import {
  selectedDeployControlPlaneOperatorAction,
  type DeployControlPlaneOperatorAction,
} from "./deploy-control-plane-operator-flags.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import {
  formatDeploymentControlPlaneRecordText,
  formatDeploymentControlPlaneStatusText,
} from "./deployment-control-plane-status-format.ts";
import { submitNixosSharedHostControlPlaneRunActionViaService } from "./nixos-shared-host-control-plane-client.ts";
import {
  readRecordForOperator,
  readStatusForOperator,
  requireLookupSelector,
  resolveServiceClientForOperator,
} from "./deploy-control-plane-operator-client.ts";

function operatorActionLabel(action: DeployControlPlaneOperatorAction): string {
  return `deploy --${action}`;
}

function requestedByFromFlags() {
  const principalId = getFlagStr("requested-by-principal", "").trim();
  const displayName = getFlagStr("requested-by-display-name", "").trim();
  if (!principalId && displayName) {
    throw new Error("--requested-by-display-name requires --requested-by-principal");
  }
  if (!principalId) return undefined;
  return {
    principalId,
    ...(displayName ? { displayName } : {}),
  };
}

function rejectTrustedClientPrincipalFlags() {
  if (getFlagStr("requested-by-principal", "").trim()) {
    throw new Error("auth-required run actions derive the principal from the service session");
  }
  if (getFlagStr("requested-by-display-name", "").trim()) {
    throw new Error("auth-required run actions derive the principal from the service session");
  }
}

function serviceAction(action: DeployControlPlaneOperatorAction): DeploymentControlPlaneRunAction {
  return action === "approve"
    ? "approve"
    : action === "cancel-run"
      ? "cancel"
      : action === "resume-run"
        ? "resume"
        : "abort";
}

function buildRunActionRequest(
  action: DeploymentControlPlaneRunAction,
  status: DeploymentControlPlaneStatus,
  authSessionId?: string,
) {
  const requestedBy = requestedByFromFlags();
  const request = {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
    actionId: `${action}-${randomUUID()}`,
    submittedAt: new Date().toISOString(),
    submissionId: status.submissionId,
    action,
    ...(authSessionId ? { authSessionId } : {}),
    ...(requestedBy ? { requestedBy } : {}),
  };
  if (action !== "approve") return request;
  const approval = status.approval;
  if (status.lifecycleState !== "pending_approval" || !approval || approval.state !== "pending") {
    throw new Error(
      `${operatorActionLabel("approve")} requires a run currently waiting for approval`,
    );
  }
  const approvalId = getFlagStr("approval-id", "").trim();
  if (!approvalId) {
    throw new Error("--approve requires --approval-id <ticket-or-review-ref>");
  }
  const approvalExpiresAt = getFlagStr("approval-expires-at", "").trim();
  return {
    ...request,
    approval: {
      approvalId,
      expectedPayloadFingerprint: approval.payloadFingerprint,
      expectedTargetIdentity: approval.targetIdentity,
      ...(approval.provisionerPlanFingerprint
        ? { expectedProvisionerPlanFingerprint: approval.provisionerPlanFingerprint }
        : {}),
      ...(approvalExpiresAt ? { expiresAt: approvalExpiresAt } : {}),
    },
  };
}

async function runActionForOperator(opts: {
  action: Extract<
    DeployControlPlaneOperatorAction,
    "approve" | "cancel-run" | "resume-run" | "abort-run"
  >;
  status: DeploymentControlPlaneStatus;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployment: DeploymentTarget;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
}) {
  const action = serviceAction(opts.action);
  const useServiceAuth = shouldUseServiceOwnedInteractiveAuth({
    deployment: opts.deployment,
    inputs: opts.vaultRuntimeInputs,
  });
  if (useServiceAuth) rejectTrustedClientPrincipalFlags();
  const authSessionId = useServiceAuth ? await authSessionForRunAction(opts, action) : undefined;
  const response = await submitNixosSharedHostControlPlaneRunActionViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
    request: buildRunActionRequest(action, opts.status, authSessionId),
  });
  printDeployJson(response);
}

async function authSessionForRunAction(
  opts: Parameters<typeof runActionForOperator>[0],
  action: DeploymentControlPlaneRunAction,
) {
  return await createAndWaitForServiceOwnedAuthSession({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { controlPlaneToken: opts.controlPlaneToken } : {}),
    deployment: opts.deployment,
    operationKind: action,
    inputs: opts.vaultRuntimeInputs,
  });
}

export async function maybeRunDeployControlPlaneOperatorCommand(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
}): Promise<boolean> {
  const action = selectedDeployControlPlaneOperatorAction();
  if (!action) return false;
  const actionLabel = operatorActionLabel(action);
  const selector = requireLookupSelector(actionLabel);
  const serviceClient = await resolveServiceClientForOperator({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    actionLabel,
  });
  if (action === "record") {
    const record = await readRecordForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...(serviceClient.controlPlaneToken
        ? { controlPlaneToken: serviceClient.controlPlaneToken }
        : {}),
      selector,
    });
    if (getFlagBool("text")) console.log(formatDeploymentControlPlaneRecordText(record));
    else printDeployJson(record);
    return true;
  }
  const status = await readStatusForOperator({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    ...(serviceClient.controlPlaneToken
      ? { controlPlaneToken: serviceClient.controlPlaneToken }
      : {}),
    selector,
  });
  if (action === "status") {
    if (getFlagBool("text")) console.log(formatDeploymentControlPlaneStatusText(status));
    else printDeployJson(status);
    return true;
  }
  if (action === "print-run-lock-scope") {
    console.log(status.lockScope);
    return true;
  }
  await runActionForOperator({
    action,
    status,
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    deployment: opts.deployment,
    vaultRuntimeInputs: opts.vaultRuntimeInputs,
    ...(serviceClient.controlPlaneToken
      ? { controlPlaneToken: serviceClient.controlPlaneToken }
      : {}),
  });
  return true;
}
