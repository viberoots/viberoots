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

test("install secret readiness propagates malformed Pleomino metadata", async () => {
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
      /missing _INFISICAL_PROJECT_ID in checked-in Pleomino metadata/,
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
      },
    });
    assert.deepEqual(calls, [["repo", "--yes"]]);
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

async function writeResolver(repoRoot: string) {
  const config = {
    defaultCategory: "main",
    profiles: {},
    categories: {
      main: { backend: "local-file", file: ".local/main.json" },
      bootstrap: { backend: "local-file", file: path.join(repoRoot, ".local/bootstrap.json") },
    },
  };
  await fsp.mkdir(path.join(repoRoot, "config/sprinkleref"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, "config/sprinkleref/selected.local.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function writeFamily(repoRoot: string, source: string) {
  const dir = path.join(repoRoot, "projects/deployments/pleomino/shared");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "family.bzl"), source);
}

function validFamilySource() {
  return `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "project"
_INFISICAL_PROJECT_NAME = "Pleomino"
_INFISICAL_PROJECT_SLUG = "pleomino"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "id_staging", "prod": "id_prod"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "staging", "prod": "prod"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "staging-client-id", "client_secret": "staging-client-secret"}, "prod": {"client_id": "prod-client-id", "client_secret": "prod-client-secret"}}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {"client_id": "secret://deployments/pleomino/staging/infisical-client-id", "client_secret": "secret://deployments/pleomino/staging/infisical-client-secret"},
    "prod": {"client_id": "secret://deployments/pleomino/prod/infisical-client-id", "client_secret": "secret://deployments/pleomino/prod/infisical-client-secret"},
}
`;
}
