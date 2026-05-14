#!/usr/bin/env zx-wrapper
import {
  redactInfisicalCredentialText,
  type InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";

export type InfisicalAdminDiagnosticStatus = "ok" | "missing" | "error" | "unsupported";

export function infisicalAdminDiagnostic(
  kind: string,
  status: InfisicalAdminDiagnosticStatus,
  detail: Record<string, unknown> = {},
) {
  return { kind, status, ...detail };
}

function credentialSecrets(credential?: InfisicalCredentialConfig): string[] {
  if (!credential) return [];
  return credential.kind === "universal_auth"
    ? [credential.clientSecret]
    : [credential.accessToken];
}

export function infisicalAdminDiagnosticErrorMessage(
  error: unknown,
  credential?: InfisicalCredentialConfig,
) {
  const message = error instanceof Error ? error.message : String(error);
  return redactInfisicalCredentialText(message, { secrets: credentialSecrets(credential) });
}

export async function checkInfisicalAdminDiagnostic(
  kind: string,
  action: () => Promise<boolean>,
  credential?: InfisicalCredentialConfig,
) {
  try {
    return infisicalAdminDiagnostic(kind, (await action()) ? "ok" : "missing");
  } catch (error) {
    return infisicalAdminDiagnostic(kind, "error", {
      message: infisicalAdminDiagnosticErrorMessage(error, credential),
    });
  }
}
