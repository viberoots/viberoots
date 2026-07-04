import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { allDevOverrideEnvNames } from "../../lib/dev-override-envs";
import { gitAutoMaintenanceDisabledTestEnvArgs } from "../../lib/git-auto-maintenance-env";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { REMOTE_SAFE_NIX_IMPURE_ENV_VARS } from "./buck2-test-env-policy";
import type { VerifyExecutionPolicy } from "./remote-policy";

type RemoteVerifyTestEnvArgsOptions = {
  nestedIso: string;
  nodeTestTimeoutMs: number;
  testNixTimeoutSecs: number;
};

const REMOTE_SAFE_PATH_ENV = new Set([
  "NIX_SSL_CERT_DIR",
  "NIX_SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
]);

const GENERATED_REMOTE_NIX_ENV = new Set(["NIX_PNPM_FETCH_TIMEOUT", "NIX_PNPM_INSTALL_TIMEOUT"]);

function isNixStorePath(value: string): boolean {
  return value === "/nix/store" || value.startsWith("/nix/store/");
}

function sameRealPath(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return left === right;
  }
}

function remoteToolPath(envName: string, tool: string): string {
  const resolved = resolveToolPathSync(tool);
  const realResolved = fs.realpathSync(resolved);
  if (!isNixStorePath(realResolved)) {
    throw new Error(`required tool must resolve to /nix/store: ${tool} -> ${resolved}`);
  }
  const ambient = process.env[envName];
  if (ambient && !sameRealPath(ambient, resolved) && !sameRealPath(ambient, realResolved)) {
    throw new Error(`${envName} must resolve through the pinned toolchain path`);
  }
  return realResolved;
}

function isKnownCertPath(value: string): boolean {
  if (!path.isAbsolute(value) || !isNixStorePath(value)) return false;
  const normalized = path.normalize(value);
  return /\/nix\/store\/[^/]*cacert[^/]*\/etc\/ssl\/certs\/ca-bundle\.crt$/.test(normalized);
}

function rejectUnsafeRemotePath(name: string, value: string): string {
  if (REMOTE_SAFE_PATH_ENV.has(name) && isKnownCertPath(value)) return value;
  try {
    const real = fs.realpathSync(value);
    if (REMOTE_SAFE_PATH_ENV.has(name) && isKnownCertPath(real)) return real;
  } catch {}
  throw new Error(`${name} must be a declared remote-safe path, got host path: ${value}`);
}

function maybeRemotePathEnv(name: string, value: string | undefined): [string, string] | null {
  if (!value) return null;
  return [name, rejectUnsafeRemotePath(name, value)];
}

function envArgs(entries: [string, string | undefined][]): string[] {
  return entries.flatMap(([name, value]) =>
    typeof value === "string" ? ["--env", `${name}=${value}`] : [],
  );
}

function assertNoUndeclaredRemoteAmbientEnv(env: NodeJS.ProcessEnv): void {
  for (const name of allDevOverrideEnvNames()) {
    if (env[name]) throw new Error(`${name} is local-only and cannot be forwarded`);
  }
  for (const name of REMOTE_SAFE_NIX_IMPURE_ENV_VARS) {
    if (GENERATED_REMOTE_NIX_ENV.has(name)) continue;
    if (env[name]) throw new Error(`${name} must be passed through a declared remote input`);
  }
}

export function buildRemoteVerifyTestEnvArgs(opts: RemoteVerifyTestEnvArgsOptions): string[] {
  assertNoUndeclaredRemoteAmbientEnv(process.env);
  const sslCertFile = process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE;
  const sslCertDir = process.env.SSL_CERT_DIR || process.env.NIX_SSL_CERT_DIR;
  const nodeExtraCaCerts = process.env.NODE_EXTRA_CA_CERTS || sslCertFile;
  const pathEntries = [
    maybeRemotePathEnv("NIX_SSL_CERT_FILE", process.env.NIX_SSL_CERT_FILE || sslCertFile),
    maybeRemotePathEnv("SSL_CERT_FILE", sslCertFile),
    maybeRemotePathEnv("NIX_SSL_CERT_DIR", process.env.NIX_SSL_CERT_DIR || sslCertDir),
    maybeRemotePathEnv("SSL_CERT_DIR", sslCertDir),
    maybeRemotePathEnv("NODE_EXTRA_CA_CERTS", nodeExtraCaCerts),
    ["NIX_BIN", remoteToolPath("NIX_BIN", "nix")],
    ["PATCH_BIN", remoteToolPath("PATCH_BIN", "patch")],
    ["GIT_BIN", remoteToolPath("GIT_BIN", "git")],
  ].filter((entry): entry is [string, string] => entry !== null);
  return [
    "--env",
    "COVERAGE=0",
    "--env",
    `TEST_NODE_OPTIONS=--test-timeout=${opts.nodeTestTimeoutMs}`,
    "--env",
    `TEST_NIX_TIMEOUT_SECS=${opts.testNixTimeoutSecs}`,
    "--env",
    `NIX_PNPM_FETCH_TIMEOUT=${opts.testNixTimeoutSecs}`,
    "--env",
    `NIX_PNPM_INSTALL_TIMEOUT=${opts.testNixTimeoutSecs}`,
    ...gitAutoMaintenanceDisabledTestEnvArgs(),
    "--env",
    `BUCK_NESTED_ISO=${opts.nestedIso}`,
    ...envArgs(pathEntries),
  ];
}

export function buildBuckProcessEnvForPolicy(
  policy: VerifyExecutionPolicy,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (policy.mode === "local") {
    const localEnv = { ...env, HOME: env.BUCK2_REAL_HOME || env.HOME };
    delete localEnv.VBR_VERIFY_REGISTER_PROCESS;
    return localEnv;
  }
  assertNoUndeclaredRemoteAmbientEnv(env);
  const out: NodeJS.ProcessEnv = {};
  for (const key of ["NIX_SSL_CERT_FILE", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"] as const) {
    const value = env[key];
    if (value) out[key] = rejectUnsafeRemotePath(key, value);
  }
  return out;
}
