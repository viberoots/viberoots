import crypto from "node:crypto";
import process from "node:process";
import { resolveToolPathSync } from "../../lib/tool-paths";

type VerifyBuck2TestEnvArgsOptions = {
  iso: string;
  passName: string;
  zxNodeModulesOut: string | null;
  nodeTestTimeoutMs: number;
  testNixTimeoutSecs: number;
};

function verifyNestedBuckIsolation(iso: string, passName: string): string {
  const seed = `${iso}:${passName}`;
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
  const ownerPid = (String(iso || "").match(/^v-(\d+)(?:-|$)/) || [])[1] || "";
  return ownerPid ? `verify-nested-${ownerPid}-${hash}` : `verify-nested-${hash}`;
}

function maybeEnvArg(name: string, value: string | undefined): string[] {
  return typeof value === "string" ? ["--env", `${name}=${value}`] : [];
}

function resolveOptionalToolPath(tool: string): string | undefined {
  try {
    return resolveToolPathSync(tool);
  } catch {
    return undefined;
  }
}

function buckdStartupTimeout(): string {
  return process.env.BUCKD_STARTUP_TIMEOUT || "300";
}

function buckdStartupInitTimeout(): string {
  return process.env.BUCKD_STARTUP_INIT_TIMEOUT || buckdStartupTimeout();
}

export function buildVerifyTestEnvArgs(opts: VerifyBuck2TestEnvArgsOptions): string[] {
  const nestedIso = verifyNestedBuckIsolation(opts.iso, opts.passName);
  const extraEnvArgs: string[] = [];
  const sslCertFile = process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE;
  const sslCertDir = process.env.SSL_CERT_DIR || process.env.NIX_SSL_CERT_DIR;
  const nodeExtraCaCerts = process.env.NODE_EXTRA_CA_CERTS || sslCertFile;
  const nixDaemonSocketPath = process.env.NIX_DAEMON_SOCKET_PATH || "/var/run/nix-daemon.socket";
  const nixRemote = process.env.NIX_REMOTE || "daemon";
  const nixBin = process.env.NIX_BIN || resolveOptionalToolPath("nix");
  const patchBin = process.env.PATCH_BIN || resolveOptionalToolPath("patch");
  const gitBin = process.env.GIT_BIN || resolveOptionalToolPath("git");
  if (process.env.TEST_TIMING) extraEnvArgs.push("--env", `TEST_TIMING=${process.env.TEST_TIMING}`);
  if (process.env.TEST_TIMING_SUMMARY) {
    extraEnvArgs.push("--env", `TEST_TIMING_SUMMARY=${process.env.TEST_TIMING_SUMMARY}`);
  }
  return [
    "--env",
    `COVERAGE=${process.env.COVERAGE || "0"}`,
    "--env",
    `TEST_NODE_OPTIONS=--test-timeout=${opts.nodeTestTimeoutMs}`,
    "--env",
    `TEST_NIX_TIMEOUT_SECS=${opts.testNixTimeoutSecs}`,
    "--env",
    `NIX_PNPM_FETCH_TIMEOUT=${opts.testNixTimeoutSecs}`,
    "--env",
    `NIX_PNPM_INSTALL_TIMEOUT=${opts.testNixTimeoutSecs}`,
    "--env",
    `VBR_BUCK_REAPER_STATE_FILE=${process.env.VBR_BUCK_REAPER_STATE_FILE || ""}`,
    "--env",
    `VBR_VERIFY_PROCESS_STATE_FILE=${process.env.VBR_VERIFY_PROCESS_STATE_FILE || ""}`,
    "--env",
    `VBR_VERIFY_LOCK_DIR=${process.env.VBR_VERIFY_LOCK_DIR || ""}`,
    "--env",
    `VBR_VERIFY_LOG_FILE=${process.env.VBR_VERIFY_LOG_FILE || ""}`,
    "--env",
    `VBR_VERIFY_REGISTER_PROCESS=1`,
    "--env",
    `VBR_TEST_SEED_STORE_PATH=${process.env.VBR_TEST_SEED_STORE_PATH || ""}`,
    "--env",
    `VBR_TEST_SEED_KEY=${process.env.VBR_TEST_SEED_KEY || ""}`,
    "--env",
    `VBR_TEST_SEED_PIN_DIR=${process.env.VBR_TEST_SEED_PIN_DIR || ""}`,
    "--env",
    `VBR_SHARED_PRELUDE_PATH=${process.env.VBR_SHARED_PRELUDE_PATH || ""}`,
    "--env",
    `VBR_AGENT_SAFEHOUSE_E2E=${process.env.VBR_AGENT_SAFEHOUSE_E2E || ""}`,
    "--env",
    `VBR_APFS_CLONE_CHECKER=${process.env.VBR_APFS_CLONE_CHECKER || ""}`,
    ...maybeEnvArg(
      "VBR_AGENT_SAFEHOUSE_E2E_PATH",
      process.env.VBR_AGENT_SAFEHOUSE_E2E === "1" ? process.env.PATH : undefined,
    ),
    "--env",
    `TEST_RSYNC_ROOTS=${process.env.TEST_RSYNC_ROOTS || ""}`,
    "--env",
    `TEST_PARTIAL_CLONE_GO_ONLY=${process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""}`,
    "--env",
    `TEST_EXCLUDE_CPP_REQS=${process.env.TEST_EXCLUDE_CPP_REQS || ""}`,
    ...maybeEnvArg("ZX_TEST_NODE_MODULES_OUT", opts.zxNodeModulesOut || undefined),
    "--env",
    `NIX_PATH=${process.env.NIX_PATH || ""}`,
    ...maybeEnvArg("XDG_CONFIG_HOME", process.env.XDG_CONFIG_HOME),
    ...maybeEnvArg("NIX_SSL_CERT_FILE", process.env.NIX_SSL_CERT_FILE || sslCertFile),
    ...maybeEnvArg("SSL_CERT_FILE", sslCertFile),
    ...maybeEnvArg("NIX_SSL_CERT_DIR", process.env.NIX_SSL_CERT_DIR || sslCertDir),
    ...maybeEnvArg("SSL_CERT_DIR", sslCertDir),
    ...maybeEnvArg("NODE_EXTRA_CA_CERTS", nodeExtraCaCerts),
    "--env",
    `NIX_DAEMON_SOCKET_PATH=${nixDaemonSocketPath}`,
    "--env",
    `NIX_REMOTE=${nixRemote}`,
    ...maybeEnvArg("NIX_BIN", nixBin),
    ...maybeEnvArg("PATCH_BIN", patchBin),
    ...maybeEnvArg("GIT_BIN", gitBin),
    "--env",
    `BUCK_NESTED_ISO=${nestedIso}`,
    "--env",
    `BUCK_EXPORTER_REUSE_DAEMON=${process.env.BUCK_EXPORTER_REUSE_DAEMON || "1"}`,
    "--env",
    `BUCKD_STARTUP_TIMEOUT=${buckdStartupTimeout()}`,
    "--env",
    `BUCKD_STARTUP_INIT_TIMEOUT=${buckdStartupInitTimeout()}`,
    ...maybeEnvArg(
      "NODE_V8_COVERAGE",
      process.env.COVERAGE === "1" ? process.env.NODE_V8_COVERAGE : undefined,
    ),
    ...extraEnvArgs,
  ];
}

export function previewVerifyNestedBuckIsolation(iso: string, passName: string): string {
  return verifyNestedBuckIsolation(iso, passName);
}
