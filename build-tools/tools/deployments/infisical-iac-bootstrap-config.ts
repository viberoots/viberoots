import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export const DEFAULT_BOOTSTRAP_ARGS: BootstrapArgs = {
  apiUrl: "https://us.infisical.com",
  cliDomain: "https://us.infisical.com/api",
  hostOverride: false,
  identityName: "viberoots-iac-bootstrap",
  orgRole: "admin",
  accessTokenEnv: "INFISICAL_ACCESS_TOKEN",
  infisicalBin: "infisical",
  noLogin: false,
  forceLogin: false,
  yes: false,
  dryRun: false,
  tofuDir: "projects/deployments/pleomino-infisical/opentofu",
  noTofuApply: false,
  rotateBootstrapCredentials: false,
  rotateDeploymentCredentials: false,
  forceOverwriteLocalCredentials: false,
  credentialSink: "auto",
  localCredentialFile: ".local/infisical-bootstrap-credentials.json",
  sprinkleCategory: "bootstrap",
  clientSecretTtl: 0,
  accessTokenTtl: 3600,
};

export function resolveInfisicalHost(host: string) {
  const normalized = host.trim();
  if (normalized === "us") {
    return { apiUrl: "https://us.infisical.com", cliDomain: "https://us.infisical.com/api" };
  }
  if (normalized === "eu") {
    return { apiUrl: "https://eu.infisical.com", cliDomain: "https://eu.infisical.com/api" };
  }
  const base = normalized.replace(/\/+$/, "");
  return {
    apiUrl: base.endsWith("/api") ? base.slice(0, -4) : base,
    cliDomain: base.endsWith("/api") ? base : `${base}/api`,
  };
}

export function canonicalInfisicalApiUrl(host?: string) {
  return host ? resolveInfisicalHost(host).apiUrl : undefined;
}
