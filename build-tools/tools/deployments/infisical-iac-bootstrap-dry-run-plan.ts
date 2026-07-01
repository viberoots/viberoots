import * as fs from "node:fs/promises";
import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { defaultDeploymentGraphPath } from "./deployment-graph-read-options";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { isGeneratedInfisicalResolverProfile } from "./infisical-iac-bootstrap-profile-kind";
import { repoBootstrapProfiles } from "./infisical-iac-bootstrap-resolver";
import type { CredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import type { SprinkleRefBackendConfig, SprinkleRefConfig } from "./sprinkleref-types";

export async function buildRepoDryRunMaterializationPlan(opts: {
  sink: CredentialSinkSelection;
  workspaceRoot?: string;
  graphPath?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const workspaceRoot = opts.workspaceRoot || (await findRepoRoot(process.cwd()));
  const configPath =
    opts.configPath || resolverConfigPath(path.join(workspaceRoot, "projects", "config"));
  const configExists = await exists(configPath);
  const config = configExists ? await readSprinkleRefConfig(configPath, workspaceRoot) : undefined;
  const profiles = await repoBootstrapProfiles({
    graphPath: opts.graphPath || defaultDeploymentGraphPath(workspaceRoot),
    workspaceRoot,
    config,
    starterCategoryProfiles: !configExists,
  });
  const profilePlans = config
    ? existingProfilePlans(config, profiles, opts.env)
    : profiles.map((profile) => missingConfigProfilePlan(profile));
  const materializedProfiles = profilePlans
    .filter((plan) => plan.wouldMaterialize)
    .map((plan) => plan.name)
    .sort();
  const validatedExistingProfiles = profilePlans
    .filter((plan) => plan.validatedExisting)
    .map((plan) => plan.name)
    .sort();
  const unresolvedExistingProfiles = profilePlans
    .filter((plan) => plan.validationBlocked)
    .map((plan) => plan.name)
    .sort();
  return {
    resolverConfig: { path: configPath, exists: configExists, wouldCreate: !configExists },
    backendLogin: {
      infisicalRequired: profilePlans.some((plan) => plan.backend === "infisical"),
      wouldAuthenticate: profilePlans.some(
        (plan) => plan.backend === "infisical" && plan.needsLiveValidation,
      ),
    },
    profiles: profilePlans,
    materializedProfiles,
    validatedExistingProfiles,
    unresolvedExistingProfiles,
    bootstrapSink: {
      kind: opts.sink.kind,
      backend: opts.sink.backend,
      category: opts.sink.category,
      wouldMaterialize: opts.sink.kind === "local-file" || opts.sink.backend === "local-file",
      wouldValidate: opts.sink.kind === "macos-keychain" || opts.sink.backend === "macos-keychain",
    },
    readOnly: true,
  };
}

function existingProfilePlans(config: SprinkleRefConfig, profiles: string[], env = process.env) {
  return profiles.map((profile) => {
    const backend = config.profiles[profile];
    if (!backend) return missingProfilePlan(profile);
    if (backend.backend === "infisical") return infisicalProfilePlan(profile, backend, env);
    if (backend.backend === "vault") return vaultProfilePlan(profile, backend);
    return {
      name: profile,
      backend: backend.backend,
      exists: true,
      wouldMaterialize: false,
      validatedExisting: false,
      unresolvedProjectIdEnv: false,
      missingProjectId: false,
      validationBlocked: false,
      needsLiveValidation: false,
    };
  });
}

function missingConfigProfilePlan(profile: string) {
  return { ...missingProfilePlan(profile), wouldCreateStarterProfile: true };
}

function missingProfilePlan(profile: string) {
  return {
    name: profile,
    backend: backendFromProfile(profile),
    exists: false,
    wouldMaterialize: true,
    validatedExisting: false,
    unresolvedProjectIdEnv: false,
    missingProjectId: false,
    validationBlocked: false,
    needsLiveValidation: true,
  };
}

function infisicalProfilePlan(
  profile: string,
  backend: SprinkleRefBackendConfig,
  env: NodeJS.ProcessEnv,
) {
  const generated = isGeneratedInfisicalResolverProfile(backend);
  const projectIdEnvValue = envValue(env, backend.projectIdEnv);
  const hasProjectId = Boolean(backend.projectId || projectIdEnvValue);
  const unresolvedProjectIdEnv = Boolean(
    !generated && !backend.projectId && backend.projectIdEnv && !projectIdEnvValue,
  );
  const missingProjectId = Boolean(!generated && !backend.projectId && !backend.projectIdEnv);
  const validationBlocked = unresolvedProjectIdEnv || missingProjectId;
  return {
    name: profile,
    backend: "infisical",
    exists: true,
    generated,
    hasProjectId,
    projectIdEnv: backend.projectIdEnv,
    projectIdEnvResolved: Boolean(projectIdEnvValue),
    unresolvedProjectIdEnv,
    missingProjectId,
    validationBlocked,
    wouldMaterialize: generated,
    validatedExisting: !generated && hasProjectId,
    needsLiveValidation: true,
  };
}

function vaultProfilePlan(profile: string, backend: SprinkleRefBackendConfig) {
  return {
    name: profile,
    backend: "vault",
    exists: true,
    hasAddress: Boolean(backend.address || backend.addressEnv),
    hasMount: Boolean(backend.mount),
    wouldMaterialize: false,
    validatedExisting: false,
    unresolvedProjectIdEnv: false,
    missingProjectId: false,
    validationBlocked: false,
    needsLiveValidation: true,
  };
}

function backendFromProfile(profile: string) {
  return profile.startsWith("infisical-") ? "infisical" : "vault";
}

function envValue(env: NodeJS.ProcessEnv, name?: string) {
  return name ? String(env[name] || "").trim() : "";
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
