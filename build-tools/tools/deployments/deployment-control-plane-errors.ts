#!/usr/bin/env zx-wrapper
import type {
  DeploymentControlPlaneRunActionRejectionCode,
  DeploymentControlPlaneSubmitRejectionCode,
} from "./deployment-control-plane-contract";

export type DeploymentAdmissionFailureCode =
  | "approval_required"
  | "approval_no_longer_valid"
  | "no_longer_admitted"
  | "supersedence_blocked";

export class DeploymentControlPlaneError extends Error {
  code:
    | DeploymentAdmissionFailureCode
    | DeploymentControlPlaneSubmitRejectionCode
    | DeploymentControlPlaneRunActionRejectionCode;

  constructor(
    code:
      | DeploymentAdmissionFailureCode
      | DeploymentControlPlaneSubmitRejectionCode
      | DeploymentControlPlaneRunActionRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentControlPlaneError";
    this.code = code;
  }
}

export class DeploymentAdmissionError extends DeploymentControlPlaneError {
  constructor(code: DeploymentAdmissionFailureCode, message: string) {
    super(code, message);
    this.name = "DeploymentAdmissionError";
  }
}

export class DeploymentIdempotencyConflictError extends DeploymentControlPlaneError {
  constructor(message: string) {
    super("idempotency_conflict", message);
    this.name = "DeploymentIdempotencyConflictError";
  }
}

export class DeploymentUnauthorizedError extends DeploymentControlPlaneError {
  statusCode = 403;

  constructor(message: string) {
    super("unauthorized", message);
    this.name = "DeploymentUnauthorizedError";
  }
}
