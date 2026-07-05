#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";
import {
  DEPLOYMENT_CONTROL_PLANE_RUN_ACTION_REQUEST_SCHEMA,
  type DeploymentControlPlaneRunAction,
  type DeploymentControlPlaneStatus,
} from "./deployment-control-plane-contract";
import {
  deployControlPlaneOperatorActionLabel,
  selectedDeployControlPlaneOperatorAction,
  type DeployControlPlaneOperatorAction,
} from "./deploy-control-plane-operator-flags";
import { printDeployJson } from "./deploy-front-door";
import {
  formatDeploymentCurrentStageStateText,
  formatDeploymentControlPlaneRecordText,
  formatDeploymentControlPlaneStatusText,
} from "./deployment-control-plane-status-format";
import { maybeRunDeployOperatorReadinessCommand } from "./deploy-operator-readiness";
import { formatDeploymentStageStateAuditEventText } from "./deployment-stage-state-audit-format";
import { submitNixosSharedHostControlPlaneRunActionViaService } from "./nixos-shared-host-control-plane-client";
import { runResourceGraphForOperator } from "./deploy-resource-graph-operator";
import {
  readRecordForOperator,
  readCurrentStageStateForOperator,
  readStageStateAuditForOperator,
  readStageHistoryForOperator,
  readStatusForOperator,
  requireLookupSelector,
  resolveServiceClientForOperator,
} from "./deploy-control-plane-operator-client";
import {
  serviceClientSelectionEvidence,
  type SelectedDeploymentServiceClient,
} from "./deployment-service-client-selection";
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
const operatorToken = (controlPlaneToken?: string) =>
  controlPlaneToken ? { controlPlaneToken } : {};
function buildRunActionRequest(
  action: DeploymentControlPlaneRunAction,
  status: DeploymentControlPlaneStatus,
  serviceClient: SelectedDeploymentServiceClient,
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
    controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
  };
  if (action !== "approve") return request;
  const approval = status.approval;
  if (status.lifecycleState !== "pending_approval" || !approval || approval.state !== "pending") {
    throw new Error(
      `${deployControlPlaneOperatorActionLabel("approve")} requires a run currently waiting for approval`,
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
  serviceClient: SelectedDeploymentServiceClient;
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
    request: buildRunActionRequest(action, opts.status, opts.serviceClient, authSessionId),
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
  if (await maybeRunDeployOperatorReadinessCommand(opts)) return true;
  const actionLabel = deployControlPlaneOperatorActionLabel(action);
  const serviceClient = await resolveServiceClientForOperator({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    actionLabel,
  });
  if (action === "current-stage-state") {
    const byDeployment = getFlagBool("by-deployment");
    const byStage = getFlagBool("by-stage");
    if (byDeployment && byStage) throw new Error("--by-deployment and --by-stage are exclusive");
    const state = await readCurrentStageStateForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...operatorToken(serviceClient.controlPlaneToken),
      ...(byStage ? {} : { deploymentId: opts.deployment.deploymentId }),
      ...(byDeployment ? {} : { environmentStage: opts.deployment.environmentStage }),
    });
    if (getFlagBool("text")) {
      const states = Array.isArray(state) ? state : [state];
      console.log(states.map(formatDeploymentCurrentStageStateText).join("\n\n"));
    } else printDeployJson(state);
    return true;
  }
  if (action === "stage-history") {
    const history = await readStageHistoryForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...operatorToken(serviceClient.controlPlaneToken),
      deploymentId: opts.deployment.deploymentId,
      environmentStage: opts.deployment.environmentStage,
    });
    if (getFlagBool("text")) {
      console.log(history.map(formatDeploymentCurrentStageStateText).join("\n\n"));
    } else printDeployJson(history);
    return true;
  }
  if (action === "stage-state-audit") {
    const events = await readStageStateAuditForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...operatorToken(serviceClient.controlPlaneToken),
      deploymentId: opts.deployment.deploymentId,
      environmentStage: opts.deployment.environmentStage,
    });
    if (getFlagBool("text")) {
      console.log(events.map(formatDeploymentStageStateAuditEventText).join("\n\n"));
    } else printDeployJson(events);
    return true;
  }
  if (action === "resource-graph") {
    await runResourceGraphForOperator(serviceClient);
    return true;
  }
  const selector = requireLookupSelector(actionLabel);
  if (action === "record") {
    const record = await readRecordForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...operatorToken(serviceClient.controlPlaneToken),
      selector,
    });
    if (getFlagBool("text")) console.log(formatDeploymentControlPlaneRecordText(record));
    else printDeployJson(record);
    return true;
  }
  const status = await readStatusForOperator({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    ...operatorToken(serviceClient.controlPlaneToken),
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
    serviceClient,
    deployment: opts.deployment,
    vaultRuntimeInputs: opts.vaultRuntimeInputs,
    ...operatorToken(serviceClient.controlPlaneToken),
  });
  return true;
}
