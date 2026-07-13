#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertClassifiedNixImpureEnv,
  LOCAL_ONLY_NIX_IMPURE_ENV_VARS,
  REMOTE_SAFE_NIX_IMPURE_ENV_VARS,
} from "../../dev/verify/buck2-test-env-policy";
import {
  buildBuckProcessEnvForPolicy,
  buildRemoteVerifyTestEnvArgs,
} from "../../dev/verify/buck2-test-remote-env";
import type { VerifyExecutionPolicy } from "../../dev/verify/remote-policy";

const remotePolicy: VerifyExecutionPolicy = {
  mode: "remote",
  buckConfig: "/tmp/vbr-remote/remote.buckconfig",
  system: "x86_64-linux",
  artifactDir: "/tmp/vbr-remote/artifacts",
  activationDir: "/tmp/vbr-remote/activation",
  profilePrefix: "linux-x86_64",
  passProfiles: {},
};

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prev)) delete process.env[key];
    Object.assign(process.env, prev);
  }
}

function remoteArgs(): string[] {
  return buildRemoteVerifyTestEnvArgs({
    nestedIso: "verify-nested-123-demo",
    nodeTestTimeoutMs: 120_000,
    testNixTimeoutSecs: 1800,
  });
}

function readImpureEnvVars(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/allowed-impure-env-vars\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, `${file} must declare allowed-impure-env-vars`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("remote verify env omits host-local verify state and developer inputs", () => {
  const args = withEnv(
    {
      NIX_DAEMON_SOCKET_PATH: "/var/run/nix-daemon.socket",
      NIX_SSL_CERT_FILE: "/nix/store/cacert/etc/ssl/certs/ca-bundle.crt",
      NODE_V8_COVERAGE: path.join(process.cwd(), "coverage/raw"),
      VBR_TEST_SEED_PIN_DIR: "/tmp/vbr-seed-pin",
      VBR_TEST_SEED_STORE_PATH: path.join(process.cwd(), "buck-out/tmp/seed"),
      ZX_TEST_NODE_MODULES_OUT: path.join(process.cwd(), "node_modules"),
    },
    remoteArgs,
  );
  const text = args.join("\n");

  for (const forbidden of [
    "NIX_DAEMON_SOCKET_PATH",
    "NIX_REMOTE",
    "NODE_V8_COVERAGE",
    "TEST_RSYNC_ROOTS",
    "VBR_TEST_SEED_PIN_DIR",
    "VBR_TEST_SEED_STORE_PATH",
    "ZX_TEST_NODE_MODULES_OUT",
    "/tmp/vbr-seed-pin",
    "/buck-out/",
    "/.direnv",
    "/node_modules",
  ]) {
    assert.doesNotMatch(text, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(
    args.some((arg) => arg.startsWith("VBR_VERIFY_REGISTER_PROCESS=")),
    false,
  );
  assert.ok(args.includes("NIX_SSL_CERT_FILE=/nix/store/cacert/etc/ssl/certs/ca-bundle.crt"));
});

test("remote verify env rejects unsafe host absolute paths and dev overrides", () => {
  for (const [name, value] of [
    ["SSL_CERT_FILE", "/tmp/cert.pem"],
    ["NIX_BIN", "/usr/bin/nix"],
    ["NIX_GO_DEV_OVERRIDE_JSON", '{"example":"/tmp/src"}'],
  ]) {
    assert.throws(
      () => withEnv({ [name]: value }, remoteArgs),
      /local-only|remote-safe path|pinned toolchain path/,
    );
  }
});

test("remote Buck process env omits local-only ambient inputs", () => {
  for (const name of [
    "WORKSPACE_ROOT",
    "ROOT_GOMOD2NIX_TOML",
    "NIX_PY_TEST_RESOLVE_JSON",
    "NIX_PNPM_ALLOW_GENERATE",
    "TEST_RSYNC_ROOTS",
  ]) {
    const env = withEnv({ [name]: "set" }, () => buildBuckProcessEnvForPolicy(remotePolicy));
    assert.equal(env[name], undefined, name);
  }
});

test("remote Buck process env rejects dev overrides and undeclared remote inputs", () => {
  for (const name of [
    "NIX_CPP_DEV_OVERRIDE_JSON",
    "BUCK_GRAPH_JSON",
    "BUCK_TARGET",
    "NIX_NODE_TEST_PATTERNS",
  ]) {
    assert.throws(
      () => withEnv({ [name]: "set" }, () => buildBuckProcessEnvForPolicy(remotePolicy)),
      /local-only|declared remote input/,
      name,
    );
  }
});

test("remote Buck process env keeps only approved process env values", () => {
  const env = withEnv(
    {
      BUCK_LOG: "debug",
      NIX_DAEMON_SOCKET_PATH: "/var/run/nix-daemon.socket",
      NIX_SSL_CERT_FILE: "/nix/store/cacert/etc/ssl/certs/ca-bundle.crt",
      TEST_RSYNC_ROOTS: "",
      WORKSPACE_ROOT: "",
    },
    () => buildBuckProcessEnvForPolicy(remotePolicy),
  );
  assert.equal(env.NIX_SSL_CERT_FILE, "/nix/store/cacert/etc/ssl/certs/ca-bundle.crt");
  assert.equal(env.BUCK_LOG, undefined);
  assert.equal(env.NIX_DAEMON_SOCKET_PATH, undefined);
  assert.equal(env.TEST_RSYNC_ROOTS, undefined);
  assert.equal(env.WORKSPACE_ROOT, undefined);
});

test("Nix impure env allowlists classify every value for remote verify policy", () => {
  const all = new Set([
    ...readImpureEnvVars("flake.nix"),
    ...readImpureEnvVars("viberoots/flake.nix"),
    ...readImpureEnvVars("viberoots/build-tools/tools/nix/flake/nix-config.nix"),
  ]);
  for (const name of all) assert.doesNotThrow(() => assertClassifiedNixImpureEnv(name));
  assert.equal(REMOTE_SAFE_NIX_IMPURE_ENV_VARS.has("NIX_PNPM_FETCH_TIMEOUT"), true);
  assert.equal(LOCAL_ONLY_NIX_IMPURE_ENV_VARS.has("NIX_PNPM_EXACT_STORE"), false);
  assert.equal(LOCAL_ONLY_NIX_IMPURE_ENV_VARS.has("NIX_PNPM_EXACT_STORE_MAP"), false);
  assert.equal(LOCAL_ONLY_NIX_IMPURE_ENV_VARS.has("NIX_GO_DEV_OVERRIDE_JSON"), true);
  assert.equal(LOCAL_ONLY_NIX_IMPURE_ENV_VARS.has("WORKSPACE_ROOT"), true);
});
