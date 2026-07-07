#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  infisicalLoginMode: "",
};

test("install secret readiness reruns bootstrap when generated Infisical profiles lack project ids", async () => {
  await withRepo(async (repoRoot) => {
    await writeGeneratedInfisicalResolver(repoRoot);
    await writeBootstrapCredentials(repoRoot);
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
    assert.deepEqual(calls, [["repo", "--yes", "--login-mode", "browser"]]);
  });
});

async function withRepo(fn: (repoRoot: string) => Promise<void>) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "install-secret-readiness-profiles-"));
  const oldProjectId = process.env.VBR_INFISICAL_PROJECT_ID;
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.VBR_INFISICAL_PROJECT_ID;
  delete process.env.SPRINKLEREF_CONFIG;
  try {
    await fn(repoRoot);
  } finally {
    if (oldProjectId === undefined) delete process.env.VBR_INFISICAL_PROJECT_ID;
    else process.env.VBR_INFISICAL_PROJECT_ID = oldProjectId;
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeGeneratedInfisicalResolver(repoRoot: string) {
  await writeJson(path.join(repoRoot, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          generatedBy: "viberoots-repo-bootstrap",
          host: "https://app.infisical.com",
          projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
          defaultEnvironment: "staging",
          defaultPath: "/",
          clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
          clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        bootstrap: { backend: "local-file", file: path.join(repoRoot, ".local/bootstrap.json") },
      },
    },
  });
}

async function writeBootstrapCredentials(repoRoot: string) {
  const scope = path.basename(repoRoot);
  await writeJson(path.join(repoRoot, ".local/bootstrap.json"), {
    [`secret://bootstrap/${scope}/viberoots-iac-bootstrap/client-id`]: "client-id",
    [`secret://bootstrap/${scope}/viberoots-iac-bootstrap/client-secret`]: "client-secret",
  });
}

async function writeJson(file: string, value: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
