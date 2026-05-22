import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export const DEPLOYMENT_BOOTSTRAP_TOFU_DIR = "projects/deployments/pleomino/infisical/opentofu";

export const DEFAULT_BOOTSTRAP_ARGS: BootstrapArgs = {
  mode: "repo",
  apiUrl: "https://app.infisical.com",
  cliDomain: "https://app.infisical.com/api",
  hostOverride: false,
  identityName: "viberoots-iac-bootstrap",
  orgRole: "admin",
  accessTokenEnv: "INFISICAL_ACCESS_TOKEN",
  infisicalBin: "infisical",
  noLogin: false,
  forceLogin: false,
  yes: false,
  dryRun: false,
  withoutDeployments: false,
  applyMetadataPatch: false,
  tofuDir: "",
  noTofuApply: false,
  rotateBootstrapCredentials: false,
  rotateDeploymentCredentials: false,
  forceOverwriteLocalCredentials: false,
  machineLabel: undefined,
  credentialSink: "auto",
  localCredentialFile: ".local/infisical-bootstrap-credentials.json",
  sprinkleCategory: "bootstrap",
  clientSecretTtl: 0,
  accessTokenTtl: 3600,
};

export function withDeploymentBootstrapDefaults(args: BootstrapArgs): BootstrapArgs {
  if (args.mode !== "deployment" || args.tofuDir) return args;
  return { ...args, tofuDir: DEPLOYMENT_BOOTSTRAP_TOFU_DIR };
}

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
