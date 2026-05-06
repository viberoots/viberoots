#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { operatorErrorFields } from "./deployment-control-plane-redaction";

export function vercelFailureErrorFields(
  error: unknown,
  opts: { secrets?: readonly string[] } = {},
): { error?: string; errorFingerprint?: string } {
  const message = error instanceof Error ? error.message : String(error);
  return operatorErrorFields(redactDeploymentAuthText(message, { secrets: opts.secrets || [] }));
}
