#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureInstallSecretReadiness,
  probeLocalSecretReadiness,
} from "../../dev/install/secret-readiness";

const baseFlags = {
  withoutSecrets: false,
  yes: false,
  machineLabel: "",
  rotateBootstrapCredentials: false,
  rotateDeploymentCredentials: false,
  forceOverwriteLocalCredentials: false,
};

test("install secret readiness skips bootstrap when local Universal Auth credentials exist", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const calls: string[][] = [];
    const stderr = await captureStderr(async () => {
      await ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      });
    });
    assert.deepEqual(calls, []);
    assert.equal(stderr, "");
    assert.equal((await probeLocalSecretReadiness(repoRoot)).ready, true);
  });
});

test("install secret readiness prompts when credentials are missing and forwards flags", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureInstallSecretReadiness({
      repoRoot,
      dryRun: false,
      verbose: false,
      flags: {
        ...baseFlags,
        machineLabel: "dev-laptop",
        rotateBootstrapCredentials: true,
        rotateDeploymentCredentials: true,
        forceOverwriteLocalCredentials: true,
      },
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
      },
    });
    assert.deepEqual(calls, [
      [
        "repo",
        "--yes",
        "--machine-label",
        "dev-laptop",
        "--rotate-bootstrap-credentials",
        "--rotate-deployment-credentials",
        "--force-overwrite-local-credentials",
      ],
    ]);
  });
});

test("install secret readiness prompts when resolver config is missing", async () => {
  await withRepo(async (repoRoot) => {
    const calls: string[][] = [];
    await ensureInstallSecretReadiness({
      repoRoot,
      dryRun: false,
      verbose: false,
      flags: baseFlags,
      deps: {
        isInteractive: () => true,
        prompt: async () => true,
        bootstrap: async (args) => void calls.push(args),
      },
    });
    assert.deepEqual(calls, [["repo", "--yes"]]);
  });
});

test("install secret readiness handles opt-out, declined prompt, and non-interactive missing setup", async () => {
  await withRepo(async (repoRoot) => {
    const calls: string[][] = [];
    await ensureInstallSecretReadiness({
      repoRoot,
      dryRun: false,
      verbose: false,
      flags: { ...baseFlags, withoutSecrets: true },
      deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
    });
    assert.deepEqual(calls, []);
    await assert.rejects(
      ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      }),
      /i --yes/,
    );
    await writeResolver(repoRoot);
    const stderr = await captureStderr(async () => {
      await ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: {
          isInteractive: () => true,
          prompt: async () => false,
          bootstrap: async (args) => void calls.push(args),
        },
      });
    });
    assert.match(stderr, /Rerun `i` and accept the prompt/);
    assert.deepEqual(calls, []);
  });
});

test("install secret readiness --yes and env override allow non-interactive repo bootstrap", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    const calls: string[][] = [];
    await ensureInstallSecretReadiness({
      repoRoot,
      dryRun: false,
      verbose: false,
      flags: { ...baseFlags, yes: true },
      deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
    });
    assert.deepEqual(calls, [["repo", "--yes"]]);
    calls.length = 0;
    const old = process.env.INSTALL_DEPS_SETUP_SECRETS;
    process.env.INSTALL_DEPS_SETUP_SECRETS = "1";
    try {
      await ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
      });
    } finally {
      if (old === undefined) delete process.env.INSTALL_DEPS_SETUP_SECRETS;
      else process.env.INSTALL_DEPS_SETUP_SECRETS = old;
    }
    assert.deepEqual(calls, [["repo", "--yes"]]);
  });
});

async function captureStderr(fn: () => Promise<void>) {
  const original = process.stderr.write;
  let output = "";
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    output += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return output;
}

async function withRepo(fn: (repoRoot: string) => Promise<void>) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "install-secret-readiness-"));
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  const oldSetupSecrets = process.env.INSTALL_DEPS_SETUP_SECRETS;
  delete process.env.SPRINKLEREF_CONFIG;
  delete process.env.INSTALL_DEPS_SETUP_SECRETS;
  try {
    await writeFamily(repoRoot);
    await fn(repoRoot);
  } finally {
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    if (oldSetupSecrets === undefined) delete process.env.INSTALL_DEPS_SETUP_SECRETS;
    else process.env.INSTALL_DEPS_SETUP_SECRETS = oldSetupSecrets;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeResolver(repoRoot: string) {
  const config = {
    defaultCategory: "main",
    profiles: {},
    categories: {
      main: { backend: "local-file", file: ".local/main.json" },
      bootstrap: { backend: "local-file", file: path.join(repoRoot, ".local/bootstrap.json") },
    },
  };
  await fsp.mkdir(path.join(repoRoot, "sprinkleref"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, "sprinkleref/selected.local.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function writeCredentials(repoRoot: string) {
  const refs = [
    "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id",
    "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret",
    "secret://deployments/fixture/staging/infisical-client-id",
    "secret://deployments/fixture/staging/infisical-client-secret",
    "secret://deployments/fixture/prod/infisical-client-id",
    "secret://deployments/fixture/prod/infisical-client-secret",
  ];
  const store = Object.fromEntries(refs.map((ref) => [ref, "present"]));
  await fsp.mkdir(path.join(repoRoot, ".local"), { recursive: true });
  await fsp.writeFile(path.join(repoRoot, ".local/bootstrap.json"), JSON.stringify(store));
}

async function writeFamily(repoRoot: string) {
  await fsp.mkdir(path.join(repoRoot, "projects/deployments/fixture/shared"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, "projects/deployments/fixture/shared/family.bzl"),
    `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "project"
_INFISICAL_PROJECT_NAME = "fixture"
_INFISICAL_PROJECT_SLUG = "fixture"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "id_staging", "prod": "id_prod"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "staging", "prod": "prod"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "staging-client-id", "client_secret": "staging-client-secret"}, "prod": {"client_id": "prod-client-id", "client_secret": "prod-client-secret"}}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {"client_id": "secret://deployments/fixture/staging/infisical-client-id", "client_secret": "secret://deployments/fixture/staging/infisical-client-secret"},
    "prod": {"client_id": "secret://deployments/fixture/prod/infisical-client-id", "client_secret": "secret://deployments/fixture/prod/infisical-client-secret"},
}
`,
  );
}
