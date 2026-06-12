import path from "node:path";

export type RemoteMode = "hybrid" | "remote" | "remote-only-conformance";

export function normalizeSpawnArg(arg: string): string {
  if (path.basename(arg) === "buck2") return "buck2";
  if (arg.startsWith("NIX_SSL_CERT_FILE=")) return "NIX_SSL_CERT_FILE=<cert>";
  if (arg.startsWith("SSL_CERT_FILE=")) return "SSL_CERT_FILE=<cert>";
  if (arg.startsWith("NODE_EXTRA_CA_CERTS=")) return "NODE_EXTRA_CA_CERTS=<cert>";
  if (arg.startsWith("NIX_BIN=")) return "NIX_BIN=<nix>";
  if (arg.startsWith("PATCH_BIN=")) return "PATCH_BIN=<patch>";
  if (arg.startsWith("GIT_BIN=")) return "GIT_BIN=<git>";
  return arg;
}

function commonTestEnvArgs(): string[] {
  return [
    "--env",
    "COVERAGE=0",
    "--env",
    "TEST_NODE_OPTIONS=--test-timeout=7200000",
    "--env",
    "TEST_NIX_TIMEOUT_SECS=1800",
    "--env",
    "NIX_PNPM_FETCH_TIMEOUT=1800",
    "--env",
    "NIX_PNPM_INSTALL_TIMEOUT=1800",
    "--env",
    "NIX_CONFIG=experimental-features = nix-command flakes\nwarn-dirty = false\nbuilders = \nbuild-hook = \nmax-jobs = auto\n",
    "--env",
    "VBR_NIX_CACHE_HEALTH_APPLIED=1",
    "--env",
    "VBR_BUCK_REAPER_STATE_FILE=",
    "--env",
    "VBR_VERIFY_PROCESS_STATE_FILE=",
    "--env",
    "VBR_VERIFY_LOCK_DIR=",
    "--env",
    "VBR_VERIFY_LOG_FILE=",
    "--env",
    "VBR_VERIFY_REGISTER_PROCESS=1",
    "--env",
    "VBR_TEST_SEED_STORE_PATH=",
    "--env",
    "VBR_TEST_SEED_KEY=",
    "--env",
    "VBR_TEST_SEED_PIN_DIR=",
    "--env",
    "VBR_SHARED_PRELUDE_PATH=",
    "--env",
    "VBR_AGENT_SAFEHOUSE_E2E=",
    "--env",
    "VBR_APFS_CLONE_CHECKER=",
    "--env",
    "TEST_RSYNC_ROOTS=",
    "--env",
    "TEST_PARTIAL_CLONE_GO_ONLY=",
    "--env",
    "TEST_EXCLUDE_CPP_REQS=",
    "--env",
    "NIX_PATH=",
    "--env",
    "NIX_SSL_CERT_FILE=<cert>",
    "--env",
    "SSL_CERT_FILE=<cert>",
    "--env",
    "NODE_EXTRA_CA_CERTS=<cert>",
    "--env",
    "NIX_DAEMON_SOCKET_PATH=/var/run/nix-daemon.socket",
    "--env",
    "NIX_REMOTE=daemon",
    "--env",
    "NIX_BIN=<nix>",
    "--env",
    "PATCH_BIN=<patch>",
    "--env",
    "GIT_BIN=<git>",
    "--env",
    "BUCK_NESTED_ISO=verify-nested-17a5591c2ed6",
    "--env",
    "BUCK_EXPORTER_REUSE_DAEMON=1",
    "--env",
    "BUCKD_STARTUP_TIMEOUT=300",
    "--env",
    "BUCKD_STARTUP_INIT_TIMEOUT=300",
  ];
}

function remoteTestEnvArgs(): string[] {
  return [
    "--env",
    "COVERAGE=0",
    "--env",
    "TEST_NODE_OPTIONS=--test-timeout=7200000",
    "--env",
    "TEST_NIX_TIMEOUT_SECS=1800",
    "--env",
    "NIX_PNPM_FETCH_TIMEOUT=1800",
    "--env",
    "NIX_PNPM_INSTALL_TIMEOUT=1800",
    "--env",
    "BUCK_NESTED_ISO=verify-nested-17a5591c2ed6",
    "--env",
    "NIX_SSL_CERT_FILE=<cert>",
    "--env",
    "SSL_CERT_FILE=<cert>",
    "--env",
    "NODE_EXTRA_CA_CERTS=<cert>",
    "--env",
    "NIX_BIN=<nix>",
    "--env",
    "PATCH_BIN=<patch>",
    "--env",
    "GIT_BIN=<git>",
  ];
}

export function localArgvSnapshot(): string[] {
  return [
    "-k",
    "10s",
    "7200s",
    "buck2",
    "--isolation-dir",
    "v-test",
    "test",
    "--console",
    "simple",
    "--num-threads",
    "3",
    "--overall-timeout",
    "7200s",
    "--target-platforms",
    "prelude//platforms:default",
    "//:target",
    "--",
    ...commonTestEnvArgs(),
  ];
}

export function remoteArgvSnapshot(opts: {
  activationDir: string;
  artifactDir: string;
  buckConfig: string;
  mode: RemoteMode;
}): string[] {
  const modeFlag = opts.mode === "remote-only-conformance" ? "--remote-only" : "--prefer-remote";
  const passDir = path.join(opts.artifactDir, "runs", "verify", "passes", "shared");
  return [
    "-k",
    "10s",
    "7200s",
    "buck2",
    "--isolation-dir",
    "v-test",
    "test",
    "--config-file",
    opts.buckConfig,
    "-c",
    "build.execution_platforms=repo_toolchains//:remote_execution_platforms",
    "--config-file",
    path.join(opts.activationDir, "shared.buckconfig"),
    modeFlag,
    "--unstable-allow-compatible-tests-on-re",
    "--event-log",
    path.join(passDir, "buck-event-log.pb.zst"),
    "--build-report",
    path.join(passDir, "buck-build-report.json"),
    "--write-build-id",
    path.join(passDir, "buck-build-id.txt"),
    "--command-report-path",
    path.join(passDir, "buck-command-report.json"),
    "--test-executor-stdout",
    path.join(passDir, "test-executor-stdout.log"),
    "--test-executor-stderr",
    path.join(passDir, "test-executor-stderr.log"),
    "--console",
    "simple",
    "--num-threads",
    "3",
    "--overall-timeout",
    "7200s",
    "--target-platforms",
    "prelude//platforms:default",
    "//:target",
    "--",
    ...remoteTestEnvArgs(),
  ];
}
