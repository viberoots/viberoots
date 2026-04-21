#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";

export type DeploymentAuthFailureCategory =
  | "idp_discovery_unavailable"
  | "idp_issuer_mismatch"
  | "browser_login_denied"
  | "browser_login_expired"
  | "vault_jwt_rejected"
  | "vault_policy_denied"
  | "jenkins_binding_missing"
  | "ci_interactive_source"
  | "unknown_auth_failure";

export type DeploymentAuthFailureDiagnostic = {
  category: DeploymentAuthFailureCategory;
  message: string;
  action: string;
};

const CATEGORY_RULES: Array<{
  category: DeploymentAuthFailureCategory;
  pattern: RegExp;
  action: string;
}> = [
  {
    category: "idp_discovery_unavailable",
    pattern:
      /OIDC request failed|openid-configuration|discovery.*(failed|unavailable)|ECONNREFUSED/i,
    action: "Verify the configured issuer URL and IdP availability before retrying.",
  },
  {
    category: "idp_issuer_mismatch",
    pattern: /issuer mismatch|discovery issuer mismatch/i,
    action: "Make vault_runtime.oidc_issuer match the issuer reported by discovery metadata.",
  },
  {
    category: "browser_login_denied",
    pattern: /access_denied|login denied|callback rejected|state mismatch/i,
    action: "Restart login and confirm the same browser session completes the deploy callback.",
  },
  {
    category: "vault_jwt_rejected",
    pattern:
      /Vault JWT login rejected|expired JWT|audience|issuer|bound claim|claim bindings|missing group|missing role/i,
    action: "Compare issuer, audience, role, group/role claims, and Vault bound claims.",
  },
  {
    category: "browser_login_expired",
    pattern: /expired|timed out|timeout/i,
    action: "Restart login and complete the browser or device flow before the timeout.",
  },
  {
    category: "vault_policy_denied",
    pattern: /permission denied|policy denied|forbidden|Vault policy denied/i,
    action: "Check the Vault policy allows the requested deployment secret path.",
  },
  {
    category: "jenkins_binding_missing",
    pattern: /Jenkins.*credential.*unset|client-secret credential is unset|withCredentials/i,
    action: "Bind the Jenkins credential inside the withCredentials block for this deploy step.",
  },
  {
    category: "ci_interactive_source",
    pattern:
      /CI deployment requires a non-interactive credential source|CI attempted an interactive/i,
    action: "Use jenkins_client_secret, jenkins_oidc, or external_oidc_token in CI.",
  },
];

export function deploymentAuthFailureDiagnostic(error: unknown): DeploymentAuthFailureDiagnostic {
  const raw = String((error as Error)?.message || error || "deployment auth failed");
  const sanitized = redactDeploymentAuthText(raw);
  const hit = CATEGORY_RULES.find((rule) => rule.pattern.test(sanitized));
  return {
    category: hit?.category || "unknown_auth_failure",
    message: sanitized,
    action: hit?.action || "Run deploy auth doctor for this deployment and inspect required setup.",
  };
}
