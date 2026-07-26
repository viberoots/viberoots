import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { gitAutoMaintenanceDisabledTestEnvArgs } from "../../lib/git-auto-maintenance-env";
import { assertSafeNixCacheConfig } from "../../lib/nix-cache-readiness";
import { nixCachePolicyBindingDigest } from "../../lib/nix-cache-policy-capability";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { buildRemoteVerifyTestEnvArgs } from "./buck2-test-remote-env";
import type { VerifyExecutionPolicy } from "./remote-policy";
import type { CacheHealthResult } from "./nix-cache-health";
import { nestedCacheRoleTransportEnv } from "./nested-cache-role-transport";
import { stripOverrideKeys } from "./nix-cache-health-config";

type VerifyBuck2TestEnvArgsOptions = {
  iso: string;
  passName: string;
  zxNodeModulesOut: string | null;
  nodeTestTimeoutMs: number;
  testNixTimeoutSecs: number;
  executionPolicy?: VerifyExecutionPolicy;
  artifactToolsRoot: string;
  cacheHealth?: CacheHealthResult;
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

function resolveNixDirenvDirenvrc(): string | undefined {
  const explicit = String(process.env.VBR_NIX_DIRENV_DIRENVRC || "").trim();
  const profiles = String(process.env.NIX_PROFILES || "")
    .split(/\s+/u)
    .filter(Boolean);
  const candidates = [
    explicit,
    ...profiles.map((profile) => path.join(profile, "share", "nix-direnv", "direnvrc")),
    path.join(String(process.env.HOME || ""), ".nix-profile", "share", "nix-direnv", "direnvrc"),
    "/nix/var/nix/profiles/default/share/nix-direnv/direnvrc",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync.native(candidate);
      if (/^\/nix\/store\/[^/]+-nix-direnv-[^/]+\/share\/nix-direnv\/direnvrc$/u.test(resolved)) {
        return resolved;
      }
    } catch {}
  }
  return undefined;
}

function buckdStartupTimeout(): string {
  return process.env.BUCKD_STARTUP_TIMEOUT || "300";
}

function buckdStartupInitTimeout(): string {
  return process.env.BUCKD_STARTUP_INIT_TIMEOUT || buckdStartupTimeout();
}

function reviewedChildNixConfig(cacheHealth: CacheHealthResult): string {
  const retained = stripOverrideKeys(cacheHealth.nixConfig);
  return [
    retained,
    `substituters = ${cacheHealth.requiredSubstituters.join(" ")}`,
    `extra-substituters = ${cacheHealth.optionalSubstituters.join(" ")}`,
    "connect-timeout = 3",
    "stalled-download-timeout = 10",
    "fallback = true",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVerifyTestEnvArgs(opts: VerifyBuck2TestEnvArgsOptions): string[] {
  if (opts.executionPolicy && opts.executionPolicy.mode !== "local") {
    return [
      ...buildRemoteVerifyTestEnvArgs({
        nestedIso: verifyNestedBuckIsolation(opts.iso, opts.passName),
        nodeTestTimeoutMs: opts.nodeTestTimeoutMs,
        testNixTimeoutSecs: opts.testNixTimeoutSecs,
      }),
      ...maybeEnvArg("VBR_ARTIFACT_TOOLS_ROOT", opts.artifactToolsRoot),
    ];
  }
  const nestedIso = verifyNestedBuckIsolation(opts.iso, opts.passName);
  const extraEnvArgs: string[] = [];
  const sslCertFile = process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE;
  const sslCertDir = process.env.SSL_CERT_DIR || process.env.NIX_SSL_CERT_DIR;
  const nodeExtraCaCerts = process.env.NODE_EXTRA_CA_CERTS || sslCertFile;
  const nixDaemonSocketPath = process.env.NIX_DAEMON_SOCKET_PATH || "/var/run/nix-daemon.socket";
  const nixRemote = process.env.NIX_REMOTE || "daemon";
  const nixBin = process.env.VBR_NIX_BIN || process.env.NIX_BIN || resolveOptionalToolPath("nix");
  const patchBin = process.env.PATCH_BIN || resolveOptionalToolPath("patch");
  const gitBin = process.env.GIT_BIN || resolveOptionalToolPath("git");
  const nixConfigEnv = withSanitizedInheritedNixConfig({
    NIX_CONFIG:
      opts.cacheHealth?.authority === "reviewed"
        ? reviewedChildNixConfig(opts.cacheHealth)
        : process.env.NIX_CONFIG,
    NIX_CONF_DIR: process.env.NIX_CONF_DIR,
  });
  assertSafeNixCacheConfig(String(nixConfigEnv.NIX_CONFIG || ""));
  const childCacheOutcome =
    opts.cacheHealth?.authority === "reviewed" && nixConfigEnv.NIX_CONFIG
      ? {
          kind: "reviewed" as const,
          config: nixConfigEnv.NIX_CONFIG,
          policy:
            process.env.VBR_NIX_CACHE_POLICY === "strict" ? ("strict" as const) : ("auto" as const),
          requiredSubstituters: opts.cacheHealth.requiredSubstituters,
          optionalSubstituters: opts.cacheHealth.optionalSubstituters,
        }
      : undefined;
  const nestedCacheTransport = childCacheOutcome
    ? nestedCacheRoleTransportEnv(childCacheOutcome)
    : {};
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
    "VBR_GC_MODE=off",
    ...maybeEnvArg("VBR_ARTIFACT_TOOLS_ROOT", opts.artifactToolsRoot),
    ...maybeEnvArg("VBR_NIX_DIRENV_DIRENVRC", resolveNixDirenvDirenvrc()),
    ...gitAutoMaintenanceDisabledTestEnvArgs(),
    ...maybeEnvArg("NIX_CONFIG", nixConfigEnv.NIX_CONFIG),
    ...maybeEnvArg("NIX_CONF_DIR", nixConfigEnv.NIX_CONF_DIR),
    ...maybeEnvArg("VBR_NIX_CACHE_POLICY", process.env.VBR_NIX_CACHE_POLICY),
    ...maybeEnvArg(
      "VBR_NIX_CACHE_ROLE_REQUIRED",
      childCacheOutcome?.requiredSubstituters.join(" "),
    ),
    ...maybeEnvArg(
      "VBR_NIX_CACHE_ROLE_OPTIONAL",
      childCacheOutcome?.optionalSubstituters.join(" "),
    ),
    ...maybeEnvArg("VBR_NIX_CACHE_ROLE_POLICY", childCacheOutcome?.policy),
    ...maybeEnvArg(
      "VBR_NIX_CACHE_ROLE_BINDING",
      childCacheOutcome ? nixCachePolicyBindingDigest(childCacheOutcome) : undefined,
    ),
    ...Object.entries(nestedCacheTransport).flatMap(([name, value]) => maybeEnvArg(name, value)),
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
    ...maybeEnvArg("VBR_NIX_BIN", nixBin),
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
