#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { ensureRepoResolverConfig } from "../../deployments/infisical-iac-bootstrap-resolver";
import {
  assertMissing,
  captureConsole,
  VAULT_PROFILE,
} from "./infisical-iac-bootstrap.resolver-profiles.helpers";
import {
  sharedConfigPath,
  tmp,
  withCwdAndEnv,
  writeGraph,
  writeJson,
} from "./infisical-iac-bootstrap.resolver-profiles.fixture";

test("repo bootstrap dry-run reports explicit Vault main backend", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const report = await ensureRepoResolverConfig({
      dryRun: true,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
      secretBackend: "vault/default",
    });
    assert.deepEqual(report.profiles, ["vault-default"]);
    assert.deepEqual(report.bootstrapCredentialProfiles, []);
    await assertMissing("projects/config/shared.json");
  });
});

test("repo bootstrap dry-run reports explicit Keychain main backend", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const report = await ensureRepoResolverConfig({
      dryRun: true,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
      secretBackend: "keychain/default",
    });
    assert.deepEqual(report.profiles, ["macos-keychain-default"]);
    assert.deepEqual(report.bootstrapCredentialProfiles, []);
    await assertMissing("projects/config/shared.json");
  });
});

test("repo bootstrap ignores inactive categories when computing required profiles", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("projects/config/shared.json", {
      sprinkleref: {
        version: 1,
        defaultCategory: "main",
        profiles: {
          "vault-default": VAULT_PROFILE,
          "infisical-control": {
            backend: "infisical",
            host: "https://app.infisical.com",
            projectIdEnv: "UNSET_INFISICAL_PROJECT_ID",
            defaultEnvironment: "prod",
            clientIdEnv: "INFISICAL_CLIENT_ID",
            clientSecretEnv: "INFISICAL_CLIENT_SECRET",
          },
        },
        categories: {
          main: { profile: "vault-default" },
          control: { profile: "infisical-control" },
          bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
        },
      },
    });
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        yes: true,
      }),
    );
    const report = JSON.parse(output.stdout);
    assert.deepEqual(report.profiles, ["vault-default"]);
    assert.deepEqual(report.bootstrapCredentialSinks, []);
  });
});

test("repo bootstrap validates bootstrap category even with explicit credential sinks", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("projects/config/shared.json", {
      sprinkleref: {
        version: 1,
        defaultCategory: "main",
        profiles: {
          "vault-default": VAULT_PROFILE,
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
    });
    await writeGraph([
      { name: "//deployments/infisical:deploy", secret_backend: "infisical/default" },
    ]);
    for (const credentialSink of ["local-file", "macos-keychain"] as const) {
      await assert.rejects(
        () =>
          runInfisicalIacBootstrap({
            ...DEFAULT_BOOTSTRAP_ARGS,
            credentialSink,
            yes: true,
          }),
        /access credential sink category bootstrap must not use an Infisical profile[\s\S]*Remediate:/,
      );
    }
  });
});
