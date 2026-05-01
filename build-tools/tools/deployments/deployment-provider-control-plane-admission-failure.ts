#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";

export function terminalSubmissionFromAdmissionFailure(opts: {
  error: unknown;
  submission: Record<string, unknown>;
  workerId: string;
}): Record<string, unknown> | undefined {
  if (!(opts.error instanceof DeploymentAdmissionError)) return undefined;
  if (opts.error.code !== "no_longer_admitted" && opts.error.code !== "approval_no_longer_valid") {
    return undefined;
  }
  return {
    ...opts.submission,
    lifecycleState: "finished",
    terminationReason: "no_longer_admitted",
    completedAt: new Date().toISOString(),
    workerId: opts.workerId,
    admission: { decision: "rejected", reason: opts.error.code },
    rejectionCode: opts.error.code,
    rejectionMessage: redactDeploymentAuthText(opts.error.message),
  };
}
