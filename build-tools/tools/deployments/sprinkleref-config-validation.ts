import { normalizeBootstrapScope } from "./infisical-iac-bootstrap-scope";
import { withNamedEnvironment } from "./sprinkleref-config-environments";
import type {
  SprinkleRefBackendConfig,
  SprinkleRefBackendKind,
  SprinkleRefCategoryConfig,
  SprinkleRefConfig,
} from "./sprinkleref-types";

const BACKENDS = new Set<SprinkleRefBackendKind>([
  "infisical",
  "vault",
  "local-file",
  "macos-keychain",
  "github-actions",
  "jenkins",
  "gitlab-ci",
  "bitbucket-pipelines",
]);

export function validateSprinkleRefConfig(config: SprinkleRefConfig, file = "SprinkleRef config") {
  const profiles = config.profiles || {};
  const categories = config.categories || {};
  if (!config.defaultCategory.trim()) throw new Error(`${file} defaultCategory is required`);
  if (config.bootstrapScope) normalizeBootstrapScope(config.bootstrapScope);
  if (config.repoInfisicalProjectName)
    validateRepoInfisicalProjectName(config.repoInfisicalProjectName, file);
  if (config.bootstrapKeychainServiceName)
    validateKeychainServiceName(config.bootstrapKeychainServiceName, file, "bootstrap");
  if (config.repoKeychainServiceName)
    validateKeychainServiceName(config.repoKeychainServiceName, file, "repo");
  if (!categories[config.defaultCategory]) {
    throw new Error(`${file} missing default category ${config.defaultCategory}`);
  }
  for (const [name, profile] of Object.entries(profiles))
    validateBackend(file, name, profile, { requireEnvironment: false });
  for (const [name, category] of Object.entries(categories))
    validateCategory(file, name, category, profiles, config.environments || {});
  return config;
}

function validateRepoInfisicalProjectName(projectName: string, file: string) {
  if (!projectName.trim()) throw new Error(`${file} repoInfisicalProjectName is required`);
  if (/[\r\n\t]/.test(projectName)) {
    throw new Error(`${file} repoInfisicalProjectName must not contain control whitespace`);
  }
}

function validateKeychainServiceName(serviceName: string, file: string, label: string) {
  if (!serviceName.trim()) throw new Error(`${file} ${label}KeychainServiceName is required`);
  if (/[\r\n\t]/.test(serviceName)) {
    throw new Error(`${file} ${label}KeychainServiceName must not contain control whitespace`);
  }
}

function validateCategory(
  file: string,
  name: string,
  category: SprinkleRefCategoryConfig,
  profiles: Record<string, SprinkleRefBackendConfig>,
  environments: NonNullable<SprinkleRefConfig["environments"]>,
) {
  if ("profile" in category) {
    const profile = profiles[category.profile];
    if (!profile) {
      throw new Error(`${file} category ${name} references missing profile ${category.profile}`);
    }
    validateBackend(file, name, withNamedEnvironment(file, name, profile, category, environments), {
      requireEnvironment: true,
    });
    return;
  }
  validateBackend(file, name, withNamedEnvironment(file, name, category, category, environments), {
    requireEnvironment: true,
  });
}

function validateBackend(
  file: string,
  name: string,
  backend: SprinkleRefBackendConfig,
  opts: { requireEnvironment: boolean },
) {
  if (!BACKENDS.has(backend.backend)) {
    throw new Error(`${file} category ${name} has unsupported backend ${String(backend.backend)}`);
  }
  if (backend.backend === "local-file" && !backend.file) {
    throw new Error(`${file} category ${name} local-file backend requires file`);
  }
  if (backend.backend === "macos-keychain" && !backend.service) {
    throw new Error(`${file} category ${name} macos-keychain backend requires service`);
  }
  if (backend.backend === "infisical") validateInfisical(file, name, backend, opts);
  if (backend.backend === "vault") validateVault(file, name, backend);
}

function validateInfisical(
  file: string,
  name: string,
  backend: SprinkleRefBackendConfig,
  opts: { requireEnvironment: boolean },
) {
  if (backend.projectRef) {
    throw new Error(
      `${file} category ${name} infisical backend uses unsupported projectRef; use projectId`,
    );
  }
  if (!backend.host) throw new Error(`${file} category ${name} infisical backend requires host`);
  if (opts.requireEnvironment && !backend.defaultEnvironment) {
    throw new Error(`${file} category ${name} infisical backend requires defaultEnvironment`);
  }
  if (!backend.projectId && !backend.projectIdEnv) {
    throw new Error(
      `${file} category ${name} infisical backend requires projectId or projectIdEnv`,
    );
  }
  if (backend.tokenEnv) {
    throw new Error(
      `${file} category ${name} infisical backend does not support tokenEnv; use Universal Auth clientIdEnv and clientSecretEnv`,
    );
  }
  if (!backend.clientIdEnv && !backend.clientIdRef) {
    throw new Error(
      `${file} category ${name} infisical backend requires clientIdEnv or clientIdRef`,
    );
  }
  if (!backend.clientSecretEnv && !backend.clientSecretRef) {
    throw new Error(
      `${file} category ${name} infisical backend requires clientSecretEnv or clientSecretRef`,
    );
  }
}

function validateVault(file: string, name: string, backend: SprinkleRefBackendConfig) {
  if (!backend.address && !backend.addressEnv) {
    throw new Error(`${file} category ${name} vault backend requires address or addressEnv`);
  }
  for (const key of ["mount", "defaultPath", "tokenEnv"] as const) {
    if (!backend[key]) throw new Error(`${file} category ${name} vault backend requires ${key}`);
  }
}
