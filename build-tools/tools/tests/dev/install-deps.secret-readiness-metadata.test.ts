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
  bootstrap: false,
  infisicalLoginMode: "",
  secretBackend: "",
};

test("install secret readiness propagates malformed deployment metadata", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeFamily(repoRoot, '_INFISICAL_SITE_URL = "https://app.infisical.com"\n');
    let bootstrapCalls = 0;
    await assert.rejects(
      ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: {
          isInteractive: () => true,
          prompt: async () => {
            throw new Error("prompt must not run");
          },
          bootstrap: async () => {
            bootstrapCalls += 1;
            throw new Error("bootstrap must not run");
          },
        },
      }),
      /missing _INFISICAL_PROJECT_ID in checked-in deployment metadata/,
    );
    assert.equal(bootstrapCalls, 0);
  });
});

test("install secret readiness still treats valid metadata with absent credentials as local setup", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeFamily(repoRoot, validFamilySource());
    const probe = await probeLocalSecretReadiness(repoRoot);
    assert.deepEqual(probe, {
      ready: false,
      reason: "missing local Universal Auth credentials",
    });
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
        selectSecretBackend: async () => "",
      },
    });
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

test("install secret readiness reports inaccessible macOS Keychain distinctly from missing credentials", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot, { backend: "macos-keychain", service: "viberoots-bootstrap" });
    await writeFamily(repoRoot, validFamilySource());
    const probe = await probeLocalSecretReadiness(repoRoot, {
      platform: "darwin",
      keychainRunner: () => ({
        status: 44,
        stderr: [
          "SecKeychainSearchCreateFromAttributes: A Module Directory Service error has occurred.",
          "SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
        ].join("\n"),
      }),
    });
    assert.equal(probe.ready, false);
    assert.match(probe.reason, /macOS Keychain service viberoots-bootstrap is inaccessible/);
    assert.match(probe.reason, /Unlock Keychain/);
    assert.doesNotMatch(probe.reason, /missing local Universal Auth credentials/);
    let bootstrapCalls = 0;
    await assert.rejects(
      ensureInstallSecretReadiness({
        repoRoot,
        dryRun: false,
        verbose: false,
        flags: baseFlags,
        deps: {
          probe: async () => probe,
          isInteractive: () => true,
          prompt: async () => {
            throw new Error("prompt must not run");
          },
          bootstrap: async () => {
            bootstrapCalls += 1;
          },
        },
      }),
      /macOS Keychain service viberoots-bootstrap is inaccessible/,
    );
    assert.equal(bootstrapCalls, 0);
  });
});

test("install secret readiness keeps missing-credential path for absent Keychain items", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot, { backend: "macos-keychain", service: "viberoots-bootstrap" });
    await writeFamily(repoRoot, validFamilySource());
    const probe = await probeLocalSecretReadiness(repoRoot, {
      platform: "darwin",
      keychainRunner: () => ({
        status: 44,
        stderr: "SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
      }),
    });
    assert.deepEqual(probe, {
      ready: false,
      reason: "missing local Universal Auth credentials",
    });
  });
});

async function withRepo(fn: (repoRoot: string) => Promise<void>) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "install-secret-metadata-"));
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.SPRINKLEREF_CONFIG;
  try {
    await fn(repoRoot);
  } finally {
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeResolver(
  repoRoot: string,
  bootstrapBackend: Record<string, string> = {
    backend: "local-file",
    file: path.join(repoRoot, ".local/bootstrap.json"),
  },
) {
  const config = {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      defaultCategory: "main",
      profiles: {},
      categories: {
        main: { backend: "local-file", file: ".local/main.json" },
        bootstrap: bootstrapBackend,
      },
    },
  };
  await fsp.mkdir(path.join(repoRoot, "projects/config"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, "projects/config/shared.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function writeFamily(repoRoot: string, source: string) {
  const dir = path.join(repoRoot, "projects/deployments/sample-webapp/shared");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "family.bzl"), source);
}

function validFamilySource() {
  return `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "project"
_INFISICAL_PROJECT_NAME = "Sample webapp"
_INFISICAL_PROJECT_SLUG = "sample-webapp"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "id_staging", "prod": "id_prod"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "staging", "prod": "prod"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "staging-client-id", "client_secret": "staging-client-secret"}, "prod": {"client_id": "prod-client-id", "client_secret": "prod-client-secret"}}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {"client_id": "secret://deployments/sample-webapp/staging/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/staging/infisical-client-secret"},
    "prod": {"client_id": "secret://deployments/sample-webapp/prod/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/prod/infisical-client-secret"},
}
`;
}
