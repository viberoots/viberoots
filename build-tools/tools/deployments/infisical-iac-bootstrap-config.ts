import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import * as path from "node:path";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { normalizeBootstrapScope } from "./infisical-iac-bootstrap-scope";

export type DeploymentBootstrapScope = {
  target: string;
  family: string;
  stage: string;
  reviewedMetadataPath: string;
  reviewedContextConfigPath: string;
  tofuDir: string;
};

export const REVIEWED_CONTEXT_CONFIG_PATH = "projects/config/shared.json";

export const DEFAULT_BOOTSTRAP_ARGS: BootstrapArgs = {
  mode: "repo",
  apiUrl: "https://app.infisical.com",
  cliDomain: "https://app.infisical.com/api",
  hostOverride: false,
  identityName: "viberoots-iac-bootstrap",
  orgRole: "admin",
  accessTokenEnv: "INFISICAL_ACCESS_TOKEN",
  infisicalBin: "infisical",
  loginMode: "browser",
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
  secretBackend: undefined,
  bootstrapCredentialScope: undefined,
  clientSecretTtl: 0,
  accessTokenTtl: 3600,
};

export async function withBootstrapCredentialScope(
  args: BootstrapArgs,
  workspaceRoot: string,
): Promise<BootstrapArgs> {
  const bootstrapCredentialScope =
    args.bootstrapCredentialScope ||
    (await configuredBootstrapScope(workspaceRoot)) ||
    defaultBootstrapScope(workspaceRoot);
  return { ...args, bootstrapCredentialScope: normalizeBootstrapScope(bootstrapCredentialScope) };
}

function defaultBootstrapScope(workspaceRoot: string) {
  return normalizeBootstrapScope(path.basename(path.resolve(workspaceRoot)));
}

async function configuredBootstrapScope(workspaceRoot: string) {
  const config = await readSprinkleRefConfig(undefined, workspaceRoot).catch((error: unknown) => {
    if (isMissingSprinkleRefConfigError(error)) return undefined;
    throw error;
  });
  return config?.bootstrapScope;
}

function isMissingSprinkleRefConfigError(error: unknown) {
  return (
    error instanceof Error &&
    (/missing projects\/config\/shared\.json sprinkleref config/.test(error.message) ||
      (error as NodeJS.ErrnoException).code === "ENOENT")
  );
}

export function withDeploymentBootstrapDefaults(args: BootstrapArgs): BootstrapArgs {
  if (args.mode !== "deployment" || args.tofuDir) return args;
  return { ...args, tofuDir: deploymentScopeFromTarget(args).tofuDir };
}

export function deploymentScopeFromTarget(args: Pick<BootstrapArgs, "target">) {
  const target = args.target?.trim();
  if (!target) throw new Error("deployment bootstrap requires --target <buck-target>");
  const match = target.match(/^\/\/projects\/deployments\/([^/:]+)\/([^/:]+):deploy$/);
  if (!match) {
    throw new Error(
      [
        `deployment bootstrap target ${target} is not supported`,
        "expected canonical target shape //projects/deployments/<family>/<stage>:deploy",
      ].join("; "),
    );
  }
  const family = match[1];
  const stage = match[2];
  if (!family || !stage) {
    throw new Error(`deployment bootstrap target ${target} is missing a family or stage`);
  }
  return {
    target,
    family,
    stage,
    reviewedMetadataPath: `projects/deployments/${family}/shared/family.bzl`,
    reviewedContextConfigPath: REVIEWED_CONTEXT_CONFIG_PATH,
    tofuDir: `projects/deployments/${family}/infisical/opentofu`,
  } satisfies DeploymentBootstrapScope;
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
