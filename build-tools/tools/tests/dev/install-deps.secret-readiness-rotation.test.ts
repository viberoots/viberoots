#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureInstallSecretReadiness } from "../../dev/install/secret-readiness";

const baseFlags = {
  withoutSecrets: false,
  yes: false,
  machineLabel: "",
  rotateBootstrapCredentials: false,
  rotateDeploymentCredentials: false,
  forceOverwriteLocalCredentials: false,
  bootstrap: false,
};

test("install secret readiness rotates even when local credentials exist", async () => {
  await withRepo(async (repoRoot) => {
    await writeResolver(repoRoot);
    await writeCredentials(repoRoot);
    const calls: string[][] = [];
    await ensureInstallSecretReadiness({
      repoRoot,
      dryRun: false,
      verbose: false,
      flags: { ...baseFlags, rotateBootstrapCredentials: true, rotateDeploymentCredentials: true },
      deps: { bootstrap: async (args) => void calls.push(args), isInteractive: () => false },
    });
    assert.deepEqual(calls, [
      ["repo", "--yes", "--rotate-bootstrap-credentials", "--rotate-deployment-credentials"],
    ]);
  });
});

async function withRepo(fn: (repoRoot: string) => Promise<void>) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "install-secret-rotation-"));
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.SPRINKLEREF_CONFIG;
  try {
    await writeFamily(repoRoot);
    await fn(repoRoot);
  } finally {
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeResolver(repoRoot: string) {
  await fsp.mkdir(path.join(repoRoot, "projects/config"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, "projects/config/shared.json"),
    `${JSON.stringify({
      schemaVersion: "viberoots-project-config@1",
      sprinkleref: {
        defaultCategory: "main",
        profiles: {},
        categories: {
          main: { backend: "local-file", file: ".local/main.json" },
          bootstrap: { backend: "local-file", file: path.join(repoRoot, ".local/bootstrap.json") },
        },
      },
    })}\n`,
  );
}

async function writeCredentials(repoRoot: string) {
  const refs = [
    `secret://bootstrap/${path.basename(repoRoot)}/viberoots-iac-bootstrap/client-id`,
    `secret://bootstrap/${path.basename(repoRoot)}/viberoots-iac-bootstrap/client-secret`,
    "secret://deployments/fixture/staging/infisical-client-id",
    "secret://deployments/fixture/staging/infisical-client-secret",
    "secret://deployments/fixture/prod/infisical-client-id",
    "secret://deployments/fixture/prod/infisical-client-secret",
  ];
  await fsp.mkdir(path.join(repoRoot, ".local"), { recursive: true });
  await fsp.writeFile(
    path.join(repoRoot, ".local/bootstrap.json"),
    JSON.stringify(Object.fromEntries(refs.map((ref) => [ref, "present"]))),
  );
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
