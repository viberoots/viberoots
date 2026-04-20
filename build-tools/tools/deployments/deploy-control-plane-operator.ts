#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { getFlagStr } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
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

function buildRunActionRequest(
  action: DeploymentControlPlaneRunAction,
  status: DeploymentControlPlaneStatus,
) {
  const requestedBy = requestedByFromFlags();
  const request = {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
    actionId: `${action}-${randomUUID()}`,
    submittedAt: new Date().toISOString(),
    submissionId: status.submissionId,
    action,
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
}) {
  const response = await submitNixosSharedHostControlPlaneRunActionViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
    request: buildRunActionRequest(
      opts.action === "approve"
        ? "approve"
        : opts.action === "cancel-run"
          ? "cancel"
          : opts.action === "resume-run"
            ? "resume"
            : "abort",
      opts.status,
    ),
  });
  printDeployJson(response);
}

export async function maybeRunDeployControlPlaneOperatorCommand(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
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
    printDeployJson(
      await readRecordForOperator({
        controlPlaneUrl: serviceClient.controlPlaneUrl,
        ...(serviceClient.controlPlaneToken
          ? { controlPlaneToken: serviceClient.controlPlaneToken }
          : {}),
        selector,
      }),
    );
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
    printDeployJson(status);
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
    ...(serviceClient.controlPlaneToken
      ? { controlPlaneToken: serviceClient.controlPlaneToken }
      : {}),
  });
  return true;
}
