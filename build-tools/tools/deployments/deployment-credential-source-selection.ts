#!/usr/bin/env zx-wrapper

export const DEPLOYMENT_CREDENTIAL_SOURCES = [
  "interactive_pkce",
  "interactive_device",
  "interactive_print_url",
  "jenkins_client_secret",
  "jenkins_oidc",
  "external_oidc_token",
] as const;

export type DeploymentCredentialSource = (typeof DEPLOYMENT_CREDENTIAL_SOURCES)[number];
export type LoginBrowserMode = "auto" | "open" | "print" | "device";

export type CredentialSourceSelection = {
  source: DeploymentCredentialSource;
  browserMode: LoginBrowserMode;
  reason: string;
};

export function normalizeCredentialSource(
  value: string | undefined,
): DeploymentCredentialSource | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (DEPLOYMENT_CREDENTIAL_SOURCES.includes(trimmed as DeploymentCredentialSource)) {
    return trimmed as DeploymentCredentialSource;
  }
  throw new Error(
    `deployment credential source must be one of ${DEPLOYMENT_CREDENTIAL_SOURCES.join(", ")}`,
  );
}

export function normalizeLoginBrowserMode(value: string | undefined): LoginBrowserMode {
  const trimmed = value?.trim() || "auto";
  if (["auto", "open", "print", "device"].includes(trimmed)) return trimmed as LoginBrowserMode;
  throw new Error("--login-browser must be one of auto, open, print, device");
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

export function isCiSession(env: NodeJS.ProcessEnv): boolean {
  return isTruthy(env.CI) || !!env.GITHUB_ACTIONS || !!env.BUILDKITE || !!env.JENKINS_URL;
}

export function isJenkinsSession(env: NodeJS.ProcessEnv): boolean {
  return !!env.JENKINS_URL || !!env.JOB_NAME || !!env.BUILD_TAG || !!env.BUILD_URL;
}

export function isSshOrHeadlessSession(env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return true;
  if (isCiSession(env)) return true;
  return !env.DISPLAY && !env.WAYLAND_DISPLAY && process.platform !== "darwin";
}

function sourceForBrowserOverride(mode: LoginBrowserMode): DeploymentCredentialSource | undefined {
  if (mode === "open") return "interactive_pkce";
  if (mode === "print") return "interactive_print_url";
  if (mode === "device") return "interactive_device";
  return undefined;
}

export function selectDeploymentCredentialSource(opts: {
  preferred?: DeploymentCredentialSource | undefined;
  loginBrowser?: LoginBrowserMode | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  deviceAuthorizationSupported?: boolean | undefined;
}): CredentialSourceSelection {
  const env = opts.env || process.env;
  const browserMode = opts.loginBrowser || "auto";
  const override = sourceForBrowserOverride(browserMode);
  if (override) return { source: override, browserMode, reason: `--login-browser=${browserMode}` };
  if (opts.preferred) {
    return { source: opts.preferred, browserMode, reason: "vault_runtime preferred source" };
  }
  if (isCiSession(env)) {
    throw new Error(
      "CI deployment requires a non-interactive credential source: jenkins_client_secret, jenkins_oidc, or external_oidc_token",
    );
  }
  if (isSshOrHeadlessSession(env)) {
    return {
      source: opts.deviceAuthorizationSupported ? "interactive_device" : "interactive_print_url",
      browserMode,
      reason: opts.deviceAuthorizationSupported
        ? "headless device authorization"
        : "headless PKCE URL",
    };
  }
  return { source: "interactive_pkce", browserMode, reason: "local interactive desktop" };
}
