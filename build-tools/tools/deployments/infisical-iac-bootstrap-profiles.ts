import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import {
  ensureProjectIdentityMembership,
  repoBootstrapCredentialRefs,
} from "./infisical-iac-bootstrap-identity";
import {
  isGeneratedInfisicalResolverProfile,
  starterInfisicalProfile,
} from "./infisical-iac-bootstrap-profile-kind";
import {
  ensureInfisicalRepoProject,
  validateInfisicalRepoProject,
} from "./infisical-iac-bootstrap-profile-api";
import type { BootstrapArgs, Identity } from "./infisical-iac-bootstrap-types";
import { withRepoInfisicalProjectName } from "./infisical-iac-bootstrap-config";
import { validateVaultRepoProfile } from "./infisical-iac-bootstrap-vault-profile";
import { readSprinkleRefConfig, validateConfig } from "./sprinkleref-config";
import type { SprinkleRefBackendConfig, SprinkleRefConfigFile } from "./sprinkleref-types";

export async function materializeRepoBackendProfiles(opts: {
  args: BootstrapArgs;
  configPath: string;
  workspaceRoot?: string;
  requiredProfiles: string[];
  api?: InfisicalApi;
  organizationId?: string;
  identity?: Identity;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const config = await readSprinkleRefConfig(opts.configPath, opts.workspaceRoot);
  const args = await withRepoInfisicalProjectName(
    repoProjectNameArgs(opts.args, config),
    opts.workspaceRoot || path.dirname(opts.configPath),
  );
  const effectiveOpts = { ...opts, args };
  const updates: Record<string, SprinkleRefBackendConfig> = {};
  const validatedExistingProfiles: string[] = [];
  const profiles = opts.requiredProfiles.map((name) => [name, config.profiles[name]] as const);
  for (const [name, profile] of profiles) {
    if (!profile && !name.startsWith("infisical-")) {
      throw new Error(`SprinkleRef config missing profile ${name}`);
    }
    if (name.startsWith("vault-") && profile) {
      await validateVaultRepoProfile(name, profile, {
        env: opts.env,
        fetchImpl: opts.fetchImpl,
      });
    }
    if (profile?.backend === "infisical" || name.startsWith("infisical-")) {
      const result = await materializeInfisicalProfile(name, profile, effectiveOpts);
      if (result.status === "validated-existing") validatedExistingProfiles.push(name);
      if (result.status === "materialized") updates[name] = result.profile;
    }
  }
  if (Object.keys(updates).length > 0)
    await writeProfileOverrides(opts.configPath, updates, opts.workspaceRoot);
  return {
    profiles: opts.requiredProfiles,
    materializedProfiles: Object.keys(updates).sort(),
    validatedExistingProfiles: validatedExistingProfiles.sort(),
  };
}

function repoProjectNameArgs(args: BootstrapArgs, config: SprinkleRefConfigFile) {
  if (args.infisicalProjectName) return args;
  if (!config.repoInfisicalProjectName) return args;
  return {
    ...args,
    infisicalProjectName: config.repoInfisicalProjectName,
    infisicalProjectNameSource: "config" as const,
  };
}

async function materializeInfisicalProfile(
  name: string,
  existingProfile: SprinkleRefBackendConfig | undefined,
  opts: {
    args: BootstrapArgs;
    api?: InfisicalApi;
    organizationId?: string;
    identity?: Identity;
    env?: NodeJS.ProcessEnv;
  },
) {
  const profile = existingProfile || starterInfisicalProfile();
  const generated = isGeneratedInfisicalResolverProfile(profile);
  const forceSelection = opts.args.selectInfisicalProject && generated;
  const projectId = forceSelection
    ? ""
    : profile.projectId || envValue(opts.env, profile.projectIdEnv);
  if (projectId) {
    if (!opts.api || !opts.organizationId) {
      throw new Error(`SprinkleRef profile ${name} requires Infisical project validation`);
    }
    const project = await validateInfisicalRepoProject(opts.api, opts.organizationId, projectId, {
      requireOrganizationEvidence: Boolean(existingProfile && !generated),
    });
    await ensureProfileIdentityMembership(opts.api, opts.identity, projectId);
    if (!generated) {
      validateInfisicalProfile(name, profile);
      return { profile, status: "validated-existing" as const };
    }
    const materialized = {
      ...profile,
      projectId,
      projectName: project.name,
      projectIdEnv: undefined,
      clientIdEnv: undefined,
      clientSecretEnv: undefined,
      ...bootstrapCredentialProfileRefs(opts.args),
    };
    validateInfisicalProfile(name, materialized);
    return sameProfile(profile, materialized)
      ? { profile, status: "unchanged-generated" as const }
      : { profile: materialized, status: "materialized" as const };
  }
  if (!opts.api || !opts.organizationId) {
    throw new Error(
      existingProfile && !generated
        ? `SprinkleRef profile ${name} requires Infisical project validation`
        : `SprinkleRef profile ${name} requires Infisical project materialization`,
    );
  }
  if (existingProfile && !generated) {
    validateInfisicalProfile(name, profile);
    throw new Error(unresolvedOperatorProfileProjectMessage(name, profile));
  }
  const projectName = opts.args.infisicalProjectName;
  if (!projectName) throw new Error("Infisical repo project name was not resolved");
  const { project } = await ensureInfisicalRepoProject(opts.api, opts.organizationId, projectName, {
    allowInteractiveSelection:
      opts.args.selectInfisicalProject || opts.args.infisicalProjectNameSource === "default",
  });
  await ensureProfileIdentityMembership(opts.api, opts.identity, project.id);
  return {
    profile: validateInfisicalProfile(name, {
      ...profile,
      projectId: project.id,
      projectName: project.name,
      projectIdEnv: undefined,
      clientIdEnv: undefined,
      clientSecretEnv: undefined,
      ...bootstrapCredentialProfileRefs(opts.args),
    }),
    status: "materialized" as const,
  };
}

function sameProfile(left: SprinkleRefBackendConfig, right: SprinkleRefBackendConfig) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateInfisicalProfile(name: string, profile: SprinkleRefBackendConfig) {
  for (const [field, value] of Object.entries(profile)) {
    if (typeof value === "string" && /placeholder|fake|example-project-id/i.test(value)) {
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
  workspaceRoot?: string,
) {
  const raw = await readConfigFile(configPath);
  const resolver = resolverConfigObject(raw);
  const resolved = await readSprinkleRefConfig(configPath, workspaceRoot);
  resolver.profiles = { ...(resolver.profiles || {}), ...profiles };
  validateConfig(
    {
      path: configPath,
      defaultCategory: resolver.defaultCategory || "main",
      environments: resolved.environments,
      profiles: { ...resolved.profiles, ...resolver.profiles },
      categories: { ...resolved.categories, ...(resolver.categories || {}) },
    },
    configPath,
  );
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

async function readConfigFile(configPath: string): Promise<SprinkleRefConfigFile> {
  return JSON.parse(await fs.readFile(configPath, "utf8")) as SprinkleRefConfigFile;
}

function resolverConfigObject(raw: SprinkleRefConfigFile): SprinkleRefConfigFile {
  const wrapped = raw as SprinkleRefConfigFile & { sprinkleref?: SprinkleRefConfigFile };
  if (wrapped.sprinkleref) return wrapped.sprinkleref;
  return raw;
}

function envValue(env = process.env, name?: string) {
  return name ? String(env[name] || "").trim() : "";
}

function unresolvedOperatorProfileProjectMessage(name: string, profile: SprinkleRefBackendConfig) {
  if (profile.projectIdEnv) {
    return `SprinkleRef profile ${name} uses operator-authored projectIdEnv ${profile.projectIdEnv}, but that environment variable is unset; export it or set projectId before rerunning repo bootstrap`;
  }
  return `SprinkleRef profile ${name} is operator-authored but has no projectId to validate`;
}

async function ensureProfileIdentityMembership(
  api: InfisicalApi,
  identity: Identity | undefined,
  projectId: string,
) {
  if (!identity) return;
  await ensureProjectIdentityMembership(api, projectId, identity);
}

function bootstrapCredentialProfileRefs(
  args: Pick<BootstrapArgs, "identityName" | "bootstrapCredentialScope">,
) {
  const refs = repoBootstrapCredentialRefs(
    { name: args.identityName },
    args.bootstrapCredentialScope,
  );
  return { clientIdRef: refs.clientIdRef, clientSecretRef: refs.clientSecretRef };
}
