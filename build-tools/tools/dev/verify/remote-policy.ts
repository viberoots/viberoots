import path from "node:path";
import { remoteActivationConfigPath } from "./remote-policy-activation";

export type VerifyRemoteExecMode = "local" | "hybrid" | "remote" | "remote-only-conformance";
export type VerifyRemoteExecSystem = "x86_64-linux" | "aarch64-linux" | "aarch64-darwin";

export type VerifyExecutionPolicy = {
  mode: VerifyRemoteExecMode;
  buckConfig: string | null;
  system: VerifyRemoteExecSystem | null;
  artifactDir: string | null;
  activationDir: string | null;
  profilePrefix: string | null;
  passProfiles: Record<string, string>;
  remoteSmoke: {
    remoteCiTools: string;
    builderUri: string;
    probeFlake: string;
    builderIdentity: string;
    reviewedBuilders: string;
    reportPath: string;
  } | null;
};

const REMOTE_MODES = new Set<VerifyRemoteExecMode>(["hybrid", "remote", "remote-only-conformance"]);

const PROFILE_PREFIX_BY_SYSTEM: Record<VerifyRemoteExecSystem, string> = {
  "x86_64-linux": "linux-x86_64",
  "aarch64-linux": "linux-aarch64",
  "aarch64-darwin": "darwin-aarch64",
};

function cleanEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] || "").trim();
}

function parseMode(raw: string): VerifyRemoteExecMode {
  if (!raw) return "local";
  if (
    raw === "local" ||
    raw === "hybrid" ||
    raw === "remote" ||
    raw === "remote-only-conformance"
  ) {
    return raw;
  }
  throw new Error(`unknown VBR_REMOTE_EXEC_MODE: ${raw}`);
}

function parseSystem(raw: string): VerifyRemoteExecSystem {
  if (raw === "x86_64-linux" || raw === "aarch64-linux" || raw === "aarch64-darwin") {
    return raw;
  }
  throw new Error(`unknown VBR_REMOTE_EXEC_SYSTEM: ${raw || "<empty>"}`);
}

function parseAbsolutePath(raw: string, name: string): string {
  if (!raw) throw new Error(`${name} is required for remote verify`);
  if (raw.includes("\0") || raw.includes("\n") || raw.includes("\r")) {
    throw new Error(`${name} must be a single absolute path`);
  }
  if (!path.isAbsolute(raw)) throw new Error(`${name} must be an absolute path`);
  const normalized = path.normalize(raw);
  if (normalized !== raw) throw new Error(`${name} must be normalized`);
  return normalized;
}

function parseNixStorePath(raw: string, name: string): string {
  const parsed = parseAbsolutePath(raw, name);
  if (!parsed.startsWith("/nix/store/")) throw new Error(`${name} must be a Nix store path`);
  return parsed;
}

function requiredEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = cleanEnvValue(env, key);
  if (!value) throw new Error(`${key} is required for remote verify`);
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${key} must be a single value`);
  }
  return value;
}

function envPassName(suffix: string): string {
  return suffix.toLowerCase().replaceAll("_", "-");
}

function parsePassProfiles(
  env: NodeJS.ProcessEnv,
  profilePrefix: string | null,
): Record<string, string> {
  const profiles: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("VBR_REMOTE_TEST_PROFILE_")) continue;
    const passName = envPassName(key.slice("VBR_REMOTE_TEST_PROFILE_".length));
    const profile = String(value || "").trim();
    if (!profile) throw new Error(`${key} must not be empty`);
    if (profilePrefix && !profile.startsWith(`${profilePrefix}-`)) {
      throw new Error(`${key} must start with ${profilePrefix}-`);
    }
    profiles[passName] = profile;
  }
  return profiles;
}

export function parseVerifyExecutionPolicy(opts?: {
  env?: NodeJS.ProcessEnv;
  coverage?: boolean;
}): VerifyExecutionPolicy {
  const env = opts?.env || process.env;
  const mode = parseMode(cleanEnvValue(env, "VBR_REMOTE_EXEC_MODE"));
  if (!REMOTE_MODES.has(mode)) {
    return {
      mode: "local",
      buckConfig: null,
      system: null,
      artifactDir: null,
      activationDir: null,
      profilePrefix: null,
      passProfiles: {},
      remoteSmoke: null,
    };
  }
  if (opts?.coverage) {
    throw new Error(
      "remote verify does not support --coverage until declared raw coverage outputs and local aggregation materialization are implemented",
    );
  }
  const system = parseSystem(cleanEnvValue(env, "VBR_REMOTE_EXEC_SYSTEM"));
  const profilePrefix = PROFILE_PREFIX_BY_SYSTEM[system];
  const artifactDir = parseAbsolutePath(
    cleanEnvValue(env, "VBR_REMOTE_ARTIFACT_DIR"),
    "VBR_REMOTE_ARTIFACT_DIR",
  );
  return {
    mode,
    buckConfig: parseAbsolutePath(
      cleanEnvValue(env, "VBR_REMOTE_BUCK_CONFIG"),
      "VBR_REMOTE_BUCK_CONFIG",
    ),
    system,
    artifactDir,
    activationDir: parseAbsolutePath(
      cleanEnvValue(env, "VBR_REMOTE_TEST_ACTIVATION_DIR"),
      "VBR_REMOTE_TEST_ACTIVATION_DIR",
    ),
    profilePrefix,
    passProfiles: parsePassProfiles(env, profilePrefix),
    remoteSmoke: {
      remoteCiTools: parseNixStorePath(
        requiredEnvValue(env, "VBR_REMOTE_CI_TOOLS"),
        "VBR_REMOTE_CI_TOOLS",
      ),
      builderUri: requiredEnvValue(env, "VBR_REMOTE_BUILDER_URI"),
      probeFlake: parseNixStorePath(
        requiredEnvValue(env, "VBR_REMOTE_PROBE_FLAKE"),
        "VBR_REMOTE_PROBE_FLAKE",
      ),
      builderIdentity: requiredEnvValue(env, "VBR_REMOTE_BUILDER_IDENTITY"),
      reviewedBuilders: parseNixStorePath(
        requiredEnvValue(env, "VBR_REMOTE_REVIEWED_BUILDERS"),
        "VBR_REMOTE_REVIEWED_BUILDERS",
      ),
      reportPath: path.join(artifactDir, "remote-builder-smoke.json"),
    },
  };
}

export function isRemoteVerifyPolicy(policy: VerifyExecutionPolicy): boolean {
  return REMOTE_MODES.has(policy.mode);
}

export function shouldComputeLocalZxTestNodeModules(policy: VerifyExecutionPolicy): boolean {
  return !isRemoteVerifyPolicy(policy);
}

export function remoteProfileForPass(
  policy: VerifyExecutionPolicy,
  passName: string,
): string | null {
  if (!isRemoteVerifyPolicy(policy) || !policy.profilePrefix) return null;
  return policy.passProfiles[passName] || `${policy.profilePrefix}-default`;
}

export function buckCqueryArgsForExecutionPolicy(policy: VerifyExecutionPolicy): string[] {
  if (!isRemoteVerifyPolicy(policy)) return [];
  return [
    ...(policy.buckConfig ? ["--config-file", policy.buckConfig] : []),
    "-c",
    "build.execution_platforms=repo_toolchains//:remote_execution_platforms",
  ];
}

export function buckTestArgsForExecutionPolicy(
  policy: VerifyExecutionPolicy,
  passName: string,
): string[] {
  if (passName === "project-enforcement") return ["--local-only", "--no-remote-cache"];
  if (!isRemoteVerifyPolicy(policy)) return [];
  const modeArgs =
    policy.mode === "remote-only-conformance"
      ? ["--remote-only"]
      : policy.mode === "remote" || policy.mode === "hybrid"
        ? ["--prefer-remote"]
        : [];
  return [
    ...buckCqueryArgsForExecutionPolicy(policy),
    "--config-file",
    remoteActivationConfigPath({
      activationDir: policy.activationDir,
      passName,
      targetProfile: remoteProfileForPass(policy, passName),
    }),
    ...modeArgs,
    "--unstable-allow-compatible-tests-on-re",
  ];
}

export function executionPolicyForVerifyPass(
  policy: VerifyExecutionPolicy,
  passName: string,
): VerifyExecutionPolicy {
  if (passName !== "project-enforcement") return policy;
  return {
    mode: "local",
    buckConfig: null,
    system: null,
    artifactDir: null,
    activationDir: null,
    profilePrefix: null,
    passProfiles: {},
    remoteSmoke: null,
  };
}

export function targetPlatformArgsForPolicy(_policy: VerifyExecutionPolicy): string[] {
  return ["--target-platforms", "prelude//platforms:default"];
}
