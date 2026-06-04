#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { materializeBootstrapCredentialSink } from "../../deployments/infisical-iac-bootstrap-sink-materialize";
import { resolveCredentialSinkSelection } from "../../deployments/infisical-iac-bootstrap-sink";

test("bootstrap credentials cannot resolve through an Infisical backend or profile", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("projects/config/shared.json", unsafeInfisicalBootstrapConfig());
    await assert.rejects(
      () =>
        resolveCredentialSinkSelection(
          { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "sprinkleref" },
          { platform: "linux", env: {} },
        ),
      /access credential sink category bootstrap must not use an Infisical profile[\s\S]*Remediate:/,
    );
  });
});

test("repo bootstrap materializes local-file bootstrap sink with restrictive mode", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const file = path.join(dir, ".local", "bootstrap.json");
    const result = await materializeBootstrapCredentialSink({
      args: { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "local-file", localCredentialFile: file },
      selection: { kind: "local-file", backend: "local-file", description: file },
    });
    assert.equal(result.materialized, true);
    assert.equal(await fs.readFile(file, "utf8"), "{}\n");
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  });
});

test("repo bootstrap preserves existing local-file sink contents while fixing mode", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const file = path.join(dir, ".local", "bootstrap.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"kept":"value"}\n', { mode: 0o644 });
    const result = await materializeBootstrapCredentialSink({
      args: { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "local-file", localCredentialFile: file },
      selection: { kind: "local-file", backend: "local-file", description: file },
    });
    assert.equal(result.materialized, true);
    assert.equal(await fs.readFile(file, "utf8"), '{"kept":"value"}\n');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  });
});

test("macOS Keychain bootstrap sink selection exposes the service to validate", () => {
  const selection = resolveCredentialSinkSelection(
    { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "macos-keychain" },
    { platform: "darwin" },
  );
  return assert.doesNotReject(async () => {
    const resolved = await selection;
    assert.equal(resolved.kind, "macos-keychain");
    assert.equal(resolved.description, "viberoots-bootstrap");
  });
});

test("repo bootstrap validates macOS Keychain sink through fake security runner", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const result = await materializeBootstrapCredentialSink({
    args: { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "macos-keychain" },
    selection: {
      kind: "macos-keychain",
      backend: "macos-keychain",
      category: "bootstrap",
      description: "viberoots-bootstrap",
    },
    platform: "darwin",
    keychainRunner: (command, args) => {
      calls.push({ command, args });
      return { status: 44 };
    },
  });
  assert.deepEqual(result, {
    materialized: false,
    kind: "macos-keychain",
    service: "viberoots-bootstrap",
  });
  assert.equal(calls[0]?.command, "security");
  assert.deepEqual(calls[0]?.args.slice(0, 4), [
    "find-generic-password",
    "-s",
    "viberoots-bootstrap",
    "-a",
  ]);
  assert.equal(calls[0]?.args[4], "viberoots-bootstrap-keychain-validation");
});

test("repo bootstrap reports Keychain remediation when service is unusable", async () => {
  await assert.rejects(
    () =>
      materializeBootstrapCredentialSink({
        args: { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "macos-keychain" },
        selection: {
          kind: "macos-keychain",
          backend: "macos-keychain",
          category: "bootstrap",
          description: "viberoots-bootstrap",
        },
        platform: "darwin",
        keychainRunner: () => ({ status: 51, stderr: "not allowed" }),
      }),
    /macOS Keychain service viberoots-bootstrap is not usable/,
  );
});

function unsafeInfisicalBootstrapConfig() {
  return {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { profile: "infisical-default" },
      },
    },
  };
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-sink-"));
}

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.SPRINKLEREF_CONFIG;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
