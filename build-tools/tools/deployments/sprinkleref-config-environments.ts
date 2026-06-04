#!/usr/bin/env zx-wrapper
import type {
  SprinkleRefBackendConfig,
  SprinkleRefCategoryConfig,
  SprinkleRefConfigFile,
  SprinkleRefEnvironmentConfig,
} from "./sprinkleref-types";

export function rejectRetiredConfigPath(selected: string) {
  const normalized = selected.split(/[\\/]+/).join("/");
  if (
    normalized.includes("config/sprinkleref/") ||
    /(^|\/)selected(\.local)?\.json$/.test(normalized)
  ) {
    throw new Error(
      "retired SprinkleRef resolver config path; use projects/config/shared.json and projects/config/local.json",
    );
  }
}

export function withNamedEnvironment(
  file: string,
  category: string,
  backend: SprinkleRefBackendConfig,
  selector: { environment?: string },
  environments: Record<string, SprinkleRefEnvironmentConfig>,
): SprinkleRefBackendConfig {
  if (!selector.environment) return backend;
  const environment = environments[selector.environment];
  if (!environment) {
    throw new Error(
      `${file} category ${category} references missing environment ${selector.environment}`,
    );
  }
  return {
    ...backend,
    defaultEnvironment: environment.infisicalEnvironment || selector.environment,
  };
}

export function readProjectEnvironments(
  raw: Record<string, unknown>,
): Record<string, SprinkleRefEnvironmentConfig> {
  if (
    !raw.environments ||
    typeof raw.environments !== "object" ||
    Array.isArray(raw.environments)
  ) {
    return {};
  }
  return raw.environments as Record<string, SprinkleRefEnvironmentConfig>;
}

export function materializeRuntimeHost(
  config: SprinkleRefConfigFile,
  projectConfig: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): SprinkleRefConfigFile {
  const runtimeHost = selectedRuntimeHost(projectConfig, env);
  if (!runtimeHost) return config;
  const hosts = projectConfig.runtimeHosts;
  if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) return config;
  const host = (hosts as Record<string, unknown>)[runtimeHost];
  if (!host || typeof host !== "object" || Array.isArray(host)) return config;
  if ((host as SprinkleRefCategoryConfig).backend === "local-file" && !("file" in host)) {
    return config;
  }
  return {
    ...config,
    categories: { ...(config.categories || {}), bootstrap: host as SprinkleRefCategoryConfig },
  };
}

function selectedRuntimeHost(projectConfig: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const explicit = env.VBR_SPRINKLEREF_RUNTIME_HOST?.trim() || env.VBR_RUNTIME_HOST?.trim() || "";
  if (explicit) return explicit;
  if (env.GITHUB_ACTIONS) return "github-actions";
  if (env.JENKINS_URL || env.BUILD_ID) return "jenkins";
  if (env.GITLAB_CI) return "gitlab-ci";
  if (env.BITBUCKET_BUILD_NUMBER) return "bitbucket-pipelines";
  const local = projectConfig.activeRuntimeHost;
  if (typeof local === "string" && local.trim()) return local.trim();
  return process.platform === "darwin" ? "local-macos" : "local-file";
}
