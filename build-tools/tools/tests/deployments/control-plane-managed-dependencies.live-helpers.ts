#!/usr/bin/env zx-wrapper
import type { ControlPlaneManagedDependencyProfile } from "../../deployments/control-plane-managed-dependency-types";

export function requireLiveEnv(
  t: { skip(reason?: string): void },
  enabledFlag: string,
  names: string[],
): Record<string, string> {
  const values = Object.fromEntries(names.map((name) => [name, String(process.env[name] || "")]));
  const missing = names.filter((name) => !values[name]);
  if (process.env[enabledFlag] !== "1" || missing.length > 0) {
    t.skip(`live conformance disabled; require ${enabledFlag}=1 and ${missing.join(", ")}`);
    return {};
  }
  return values;
}

export function liveArtifactProfile(
  t: { skip(reason?: string): void },
  provider: "supabase-storage-s3" | "cloudflare-r2",
  opts: { enabledFlag: string; envPrefix: string },
): ControlPlaneManagedDependencyProfile | undefined {
  const env = requireLiveEnv(t, opts.enabledFlag, [
    `${opts.envPrefix}_ENDPOINT_FILE`,
    `${opts.envPrefix}_ACCESS_KEY_ID_FILE`,
    `${opts.envPrefix}_SECRET_ACCESS_KEY_FILE`,
    `${opts.envPrefix}_BUCKET`,
    `${opts.envPrefix}_REGION`,
  ]);
  if (!env[`${opts.envPrefix}_ENDPOINT_FILE`]) return undefined;
  return {
    profileName: `live-${provider}`,
    postgres: { provider: "postgres-compatible", urlFile: "/dev/null" },
    artifactStore: {
      provider,
      bucket: env[`${opts.envPrefix}_BUCKET`],
      region: env[`${opts.envPrefix}_REGION`],
      endpointFile: env[`${opts.envPrefix}_ENDPOINT_FILE`],
      accessKeyIdFile: env[`${opts.envPrefix}_ACCESS_KEY_ID_FILE`],
      secretAccessKeyFile: env[`${opts.envPrefix}_SECRET_ACCESS_KEY_FILE`],
      keyPrefix: env[`${opts.envPrefix}_PREFIX`] || `tmp/vbr-${provider}-live`,
    },
  };
}

export function livePlaceholderArtifactStore(): ControlPlaneManagedDependencyProfile["artifactStore"] {
  return {
    provider: "s3-compatible",
    bucket: "unused",
    region: "unused",
    endpointFile: "/dev/null",
    accessKeyIdFile: "/dev/null",
    secretAccessKeyFile: "/dev/null",
  };
}
