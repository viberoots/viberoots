export const ARTIFACT_SELECTORS = new Set([
  "AR",
  "BUCK_GRAPH_JSON",
  "BUCK_QUERY_ROOTS",
  "BUCK_TARGET",
  "BUCK_TARGET_ATTR",
  "BUCK_TARGET_PLATFORM",
  "BUCK_TEST_SRC",
  "CC",
  "CPATH",
  "CFLAGS",
  "CPPFLAGS",
  "CXX",
  "SDKROOT",
  "CXXFLAGS",
  "COVERAGE",
  "GOPATH",
  "GOROOT",
  "GCC",
  "CLANG",
  "LD",
  "LDFLAGS",
  "LIBRARY_PATH",
  "NIX_PATH",
  "NODE_OPTIONS",
  "NODE",
  "NODE_PATH",
  "NPM_CONFIG_PREFIX",
  "PKG_CONFIG_PATH",
  "PNPM_HOME",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHON",
  "UV",
  "PNPM",
  "PLANNER_ONLY_CPP",
  "RUSTC",
  "RUSTFLAGS",
  "RUSTUP_HOME",
  "CARGO_HOME",
  "WORKSPACE_ROOT",
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_FILTERED_FLAKE_SNAPSHOT",
  "VBR_PNPM_FILTERED_SNAPSHOT_ROOT",
  "VBR_PNPM_FINAL_STORE",
  "VBR_PNPM_FINAL_STORE_IMPORTER",
  "VIBEROOTS_FLAKE_INPUT_ROOT",
  "VIBEROOTS_ROOT",
  "VIBEROOTS_SOURCE_ROOT",
]);

const ARTIFACT_ENV_EXACT = new Set([
  "AR",
  "AS",
  "CC",
  "CPP",
  "CPATH",
  "CXX",
  "LD",
  "LIBRARY_PATH",
  "MAKEFLAGS",
  "NM",
  "RANLIB",
  "STRIP",
  "SDKROOT",
  "SSL_CERT_FILE",
  "VIRTUAL_ENV",
]);
const ARTIFACT_ENV_PREFIXES = [
  "BUCK_",
  "CARGO_",
  "CMAKE_",
  "CGO_",
  "COREPACK_",
  "MESON_",
  "NIX_",
  "NODE_",
  "NPM_CONFIG_",
  "PIP_",
  "PKG_CONFIG_",
  "PNPM_",
  "PYTHON",
  "RUST",
  "UV_",
] as const;

const ARTIFACT_NEUTRAL_ENV = new Set([
  "BUCKD_STARTUP_INIT_TIMEOUT",
  "BUCKD_STARTUP_TIMEOUT",
  "BUCK_ISOLATION_DIR",
  "BUCK_NESTED_ISO",
  "NIX_DAEMON_SOCKET_PATH",
  "NIX_REMOTE",
  "NIX_SSL_CERT_DIR",
  "NIX_SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "VBR_VERIFY_PROCESS_STATE_FILE",
]);

export function isArtifactAffectingEnvName(name: string): boolean {
  return (
    ARTIFACT_ENV_EXACT.has(name) ||
    ARTIFACT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    /(?:FLAGS|_INCLUDE_PATH)$/u.test(name) ||
    /^(?:GOFLAGS|GOMODCACHE|GOPATH|GOPROXY|GOROOT|GOSUMDB|GOTOOLCHAIN)$/u.test(name)
  );
}

export function withoutArtifactEnvironmentInfluence(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        value !== undefined && !ARTIFACT_SELECTORS.has(name) && !isArtifactAffectingEnvName(name),
    ),
  );
}

function selectorNames(
  env: NodeJS.ProcessEnv,
  allowed: Set<string>,
  rejectUnknownArtifactAffecting: boolean,
): string[] {
  const rejected = [...ARTIFACT_SELECTORS].filter(
    (name) => !allowed.has(name) && String(env[name] || "").trim(),
  );
  for (const [name, raw] of Object.entries(env)) {
    if (!rejectUnknownArtifactAffecting) break;
    if (
      allowed.has(name) ||
      ARTIFACT_SELECTORS.has(name) ||
      ARTIFACT_NEUTRAL_ENV.has(name) ||
      !String(raw || "").trim() ||
      !isArtifactAffectingEnvName(name)
    ) {
      continue;
    }
    rejected.push(name);
  }
  return [...new Set(rejected)].sort();
}

export function assertNoArtifactSelectorInjection(
  env: NodeJS.ProcessEnv,
  opts: { allow?: readonly string[]; rejectUnknownArtifactAffecting?: boolean } = {},
): void {
  const selectors = selectorNames(
    env,
    new Set(opts.allow || []),
    opts.rejectUnknownArtifactAffecting ?? true,
  );
  if (selectors.length === 0) return;
  throw new Error(
    `artifact build rejects ambient selectors: ${selectors.join(", ")}; remove them and declare the values in the evaluation bundle`,
  );
}

export function artifactSelectorNames(): string[] {
  return [...ARTIFACT_SELECTORS].sort();
}
