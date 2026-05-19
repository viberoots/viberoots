import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import {
  ensureInfisicalRepoProject,
  validateInfisicalRepoProject,
} from "./infisical-iac-bootstrap-profile-api";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { validateVaultRepoProfile } from "./infisical-iac-bootstrap-vault-profile";
import { readSprinkleRefConfig, validateConfig } from "./sprinkleref-config";
import type { SprinkleRefBackendConfig, SprinkleRefConfigFile } from "./sprinkleref-types";

export async function materializeRepoBackendProfiles(opts: {
  args: BootstrapArgs;
  configPath: string;
  requiredProfiles: string[];
  api?: InfisicalApi;
  organizationId?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const config = await readSprinkleRefConfig(opts.configPath);
  const updates: Record<string, SprinkleRefBackendConfig> = {};
  const profiles = opts.requiredProfiles.map((name) => [name, config.profiles[name]] as const);
  for (const [name, profile] of profiles) {
    if (!profile) throw new Error(`SprinkleRef config missing profile ${name}`);
    if (name.startsWith("vault-")) {
      await validateVaultRepoProfile(name, profile, {
        env: opts.env,
        fetchImpl: opts.fetchImpl,
      });
    }
    if (profile.backend === "infisical") {
      const materialized = await materializeInfisicalProfile(name, profile, opts);
      if (materialized !== profile) updates[name] = materialized;
    }
  }
  if (Object.keys(updates).length > 0) await writeProfileOverrides(opts.configPath, updates);
  return {
    profiles: opts.requiredProfiles,
    materializedProfiles: Object.keys(updates).sort(),
  };
}

async function materializeInfisicalProfile(
  name: string,
  profile: SprinkleRefBackendConfig,
  opts: {
    args: BootstrapArgs;
    api?: InfisicalApi;
    organizationId?: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  const projectId = profile.projectId || envValue(opts.env, profile.projectIdEnv);
  if (projectId) {
    if (!opts.api || !opts.organizationId) {
      throw new Error(`SprinkleRef profile ${name} requires Infisical project validation`);
    }
    await validateInfisicalRepoProject(opts.api, opts.organizationId, projectId);
    validateInfisicalProfile(name, { ...profile, projectId });
    return profile.projectId ? profile : { ...profile, projectId };
  }
  if (!opts.api || !opts.organizationId) {
    throw new Error(`SprinkleRef profile ${name} requires Infisical project materialization`);
  }
  const { project } = await ensureInfisicalRepoProject(opts.api, opts.organizationId);
  return validateInfisicalProfile(name, {
    ...profile,
    projectId: project.id,
    projectIdEnv: undefined,
  });
}

function validateInfisicalProfile(name: string, profile: SprinkleRefBackendConfig) {
  for (const [field, value] of Object.entries(profile)) {
    if (typeof value === "string" && /placeholder|fake|pleomino-project-id/i.test(value)) {
      throw new Error(
        `SprinkleRef profile ${name} has placeholder ${field}; replace it with real Infisical metadata`,
      );
    }
  }
  return profile;
}

async function writeProfileOverrides(
  configPath: string,
  profiles: Record<string, SprinkleRefBackendConfig>,
) {
  const raw = await readConfigFile(configPath);
  raw.profiles = { ...(raw.profiles || {}), ...profiles };
  validateConfig(
    {
      path: configPath,
      defaultCategory: raw.defaultCategory || "main",
      profiles: raw.profiles,
      categories: raw.categories || {},
    },
    configPath,
  );
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

async function readConfigFile(configPath: string): Promise<SprinkleRefConfigFile> {
  return JSON.parse(await fs.readFile(configPath, "utf8")) as SprinkleRefConfigFile;
}

function envValue(env = process.env, name?: string) {
  return name ? String(env[name] || "").trim() : "";
}
