import * as fs from "node:fs/promises";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { requiredBackendProfiles } from "./infisical-iac-bootstrap-resolver";
import type { CredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import type { SprinkleRefBackendConfig } from "./sprinkleref-types";

export async function buildRepoDryRunMaterializationPlan(opts: {
  sink: CredentialSinkSelection;
  graphPath?: string;
  configPath?: string;
}) {
  const configPath = opts.configPath || resolverConfigPath();
  const configExists = await exists(configPath);
  const profiles = [
    ...(await requiredBackendProfiles(opts.graphPath || DEFAULT_GRAPH_PATH)),
  ].sort();
  const profilePlans = configExists
    ? await existingProfilePlans(configPath, profiles)
    : profiles.map((profile) => missingConfigProfilePlan(profile));
  return {
    resolverConfig: { path: configPath, exists: configExists, wouldCreate: !configExists },
    backendLogin: {
      infisicalRequired: profilePlans.some((plan) => plan.backend === "infisical"),
      wouldAuthenticate: profilePlans.some(
        (plan) => plan.backend === "infisical" && plan.needsLiveValidation,
      ),
    },
    profiles: profilePlans,
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

async function existingProfilePlans(configPath: string, profiles: string[]) {
  const config = await readSprinkleRefConfig(configPath);
  return profiles.map((profile) => {
    const backend = config.profiles[profile];
    if (!backend) return missingProfilePlan(profile);
    if (backend.backend === "infisical") return infisicalProfilePlan(profile, backend);
    if (backend.backend === "vault") return vaultProfilePlan(profile, backend);
    return {
      name: profile,
      backend: backend.backend,
      exists: true,
      wouldMaterialize: false,
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
    needsLiveValidation: true,
  };
}

function infisicalProfilePlan(profile: string, backend: SprinkleRefBackendConfig) {
  return {
    name: profile,
    backend: "infisical",
    exists: true,
    hasProjectId: Boolean(backend.projectId || backend.projectIdEnv),
    wouldMaterialize: !backend.projectId && !backend.projectIdEnv,
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
    needsLiveValidation: true,
  };
}

function backendFromProfile(profile: string) {
  return profile.startsWith("infisical-") ? "infisical" : "vault";
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
