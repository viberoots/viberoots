import crypto from "node:crypto";
import process from "node:process";

type VerifyBuck2TestEnvArgsOptions = {
  iso: string;
  passName: string;
  zxNodeModulesOut: string;
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

export function buildVerifyTestEnvArgs(opts: VerifyBuck2TestEnvArgsOptions): string[] {
  const nestedIso = verifyNestedBuckIsolation(opts.iso, opts.passName);
  const extraEnvArgs: string[] = [];
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
    `BNX_BUCK_REAPER_STATE_FILE=${process.env.BNX_BUCK_REAPER_STATE_FILE || ""}`,
    "--env",
    `BNX_VERIFY_PROCESS_STATE_FILE=${process.env.BNX_VERIFY_PROCESS_STATE_FILE || ""}`,
    "--env",
    `BNX_VERIFY_LOCK_DIR=${process.env.BNX_VERIFY_LOCK_DIR || ""}`,
    "--env",
    `BNX_VERIFY_LOG_FILE=${process.env.BNX_VERIFY_LOG_FILE || ""}`,
    "--env",
    `BNX_TEST_SEED_STORE_PATH=${process.env.BNX_TEST_SEED_STORE_PATH || ""}`,
    "--env",
    `BNX_TEST_SEED_KEY=${process.env.BNX_TEST_SEED_KEY || ""}`,
    "--env",
    `BNX_TEST_SEED_PIN_DIR=${process.env.BNX_TEST_SEED_PIN_DIR || ""}`,
    "--env",
    `BNX_SHARED_PRELUDE_PATH=${process.env.BNX_SHARED_PRELUDE_PATH || ""}`,
    "--env",
    `TEST_RSYNC_ROOTS=${process.env.TEST_RSYNC_ROOTS || ""}`,
    "--env",
    `TEST_PARTIAL_CLONE_GO_ONLY=${process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""}`,
    "--env",
    `TEST_EXCLUDE_CPP_REQS=${process.env.TEST_EXCLUDE_CPP_REQS || ""}`,
    "--env",
    `ZX_TEST_NODE_MODULES_OUT=${opts.zxNodeModulesOut}`,
    "--env",
    `NIX_PATH=${process.env.NIX_PATH || ""}`,
    "--env",
    `BUCK_NESTED_ISO=${nestedIso}`,
    "--env",
    `BUCK_EXPORTER_REUSE_DAEMON=${process.env.BUCK_EXPORTER_REUSE_DAEMON || "1"}`,
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
