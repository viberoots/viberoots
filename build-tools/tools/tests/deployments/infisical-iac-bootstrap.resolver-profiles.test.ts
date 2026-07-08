#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";
import { ensureRepoResolverConfig } from "../../deployments/infisical-iac-bootstrap-resolver";
import {
  assertMissing,
  captureConsole,
  VAULT_PROFILE,
} from "./infisical-iac-bootstrap.resolver-profiles.helpers";
import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

test("auto credential sink reuses existing SprinkleRef resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("projects/config/shared.json", {
      sprinkleref: {
        version: 1,
        defaultCategory: "bootstrap",
        categories: { bootstrap: { backend: "local-file", file: "kept-bootstrap.json" } },
      },
    });
    const selection = await resolveCredentialSinkSelection(DEFAULT_BOOTSTRAP_ARGS, {
      platform: "linux",
      env: {},
    });
    assert.equal(selection.kind, "sprinkleref");
    assert.equal(selection.backend, "local-file");
    assert.ok(selection.configPath?.endsWith(sharedConfigPath()));
    await assertMissing("projects/config/local.json");
  });
});

test("repo bootstrap auto credential sink creates starter resolver config only when none exists", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const sink = await createCredentialSink(
      { ...DEFAULT_BOOTSTRAP_ARGS, mode: "repo" },
      { platform: "linux", env: {} },
    );
    assert.match(sink.describe(), /SprinkleRef bootstrap local-file/);
    const shared = await fs.readFile(sharedConfigPath(), "utf8");
    assert.match(shared, /"runtimeHosts"/);
    assert.match(shared, /"backend": "local-file"/);
    assert.doesNotMatch(shared, /"file": ".local\/infisical\/bootstrap\/credentials.json"/);
    assert.doesNotMatch(shared, /clientSecret":/);
    const local = await fs.readFile(path.join(projectConfigDir(), "local.json"), "utf8");
    assert.match(local, /"file": ".local\/infisical\/bootstrap\/credentials.json"/);
  });
});

test("repo bootstrap auto credential sink rejects invalid existing shared project config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await fs.mkdir(projectConfigDir(), { recursive: true });
    await fs.writeFile(sharedConfigPath(), "operator-owned\n");
    await assert.rejects(
      () =>
        createCredentialSink(
          { ...DEFAULT_BOOTSTRAP_ARGS, mode: "repo" },
          { platform: "linux", env: {} },
        ),
      /invalid project config JSON/,
    );
    assert.equal(await fs.readFile(sharedConfigPath(), "utf8"), "operator-owned\n");
  });
});

test("repo bootstrap creates and validates resolver profiles independent of credential sink", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeGraph([
      { name: "//deployments/vault:deploy", secret_backend: "vault/default" },
      { name: "//deployments/infisical:deploy", secret_backend: "infisical/default" },
    ]);
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        yes: true,
      }),
    );
    assert.doesNotMatch(output.stdout, /nextCommands/);
    assert.match(output.stderr, /projects\/config\/shared\.json/);
    const report = JSON.parse(output.stdout);
    assert.equal(report.nextCommands, undefined);
    assert.equal(report.bootstrapCredentialSinks.length, 2);
    assert.equal(report.bootstrapCredentialSinks[0]?.profile, "infisical-control");
    assert.equal(report.bootstrapCredentialSinks[0]?.credentialSinkBackend, "local-file");
    assert.deepEqual(report.profileMaterialization?.materializedProfiles, [
      "infisical-control",
      "infisical-default",
    ]);
    assert.deepEqual(report.profileMaterialization?.validatedExistingProfiles, []);
    const selected = await fs.readFile(sharedConfigPath(), "utf8");
    assert.match(selected, /"infisical-default"/);
    assert.match(selected, /"backend": "infisical"/);
  });
});

test("repo bootstrap materializes missing non-default Infisical profiles", async () => {
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
            projectId: "proj_repo_test",
            defaultEnvironment: "staging",
            clientIdEnv: "INFISICAL_CLIENT_ID",
            clientSecretEnv: "INFISICAL_CLIENT_SECRET",
          },
        },
        categories: {
          main: { profile: "infisical-default" },
          bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
        },
      },
    });
    await writeGraph([
      {
        name: "//deployments/regulated:deploy",
        secret_backend: "infisical/regulated",
      },
    ]);
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({ ...DEFAULT_BOOTSTRAP_ARGS, yes: true }),
    );
    const report = JSON.parse(output.stdout);
    assert.deepEqual(report.profileMaterialization?.materializedProfiles, ["infisical-regulated"]);
    assert.deepEqual(report.profileMaterialization?.validatedExistingProfiles, [
      "infisical-default",
    ]);
    assert.match(await fs.readFile(sharedConfigPath(), "utf8"), /"infisical-regulated"/);
  });
});

test("repo bootstrap can select Vault as the default main secret backend", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        secretBackend: "vault/default",
        yes: true,
      }),
    );
    const report = JSON.parse(output.stdout);
    assert.deepEqual(report.profiles, ["vault-default"]);
    assert.deepEqual(report.bootstrapCredentialSinks, []);
    assert.equal(report.verification.bootstrap.status, "not-required");
    assert.equal(report.verification.main.backend, "vault");
    const shared = await fs.readFile(sharedConfigPath(), "utf8");
    assert.match(shared, /"defaultCategory": "main"/);
    assert.match(shared, /"main": \{\n\s+"profile": "vault-default"\n\s+\}/);
  });
});

test("repo bootstrap can select macOS Keychain as the default main secret backend", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        secretBackend: "keychain/default",
        yes: true,
      }),
    );
    const report = JSON.parse(output.stdout);
    assert.deepEqual(report.profiles, ["macos-keychain-default"]);
    assert.deepEqual(report.bootstrapCredentialSinks, []);
    assert.equal(report.verification.bootstrap.status, "not-required");
    assert.equal(report.verification.main.backend, "macos-keychain");
    const shared = await fs.readFile(sharedConfigPath(), "utf8");
    assert.match(shared, /"defaultCategory": "main"/);
    assert.match(shared, /"macos-keychain-default"/);
    assert.match(shared, new RegExp(`"service": "${path.basename(dir)}"`));
  });
});

test("repo bootstrap repairs legacy bootstrap Keychain service to repo default", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeBootstrapKeychainConfig("viberoots-bootstrap");
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(
      shared.sprinkleref.categories.bootstrap.service,
      `${path.basename(dir)}-bootstrap`,
    );
  });
});

test("repo bootstrap repairs legacy runtime host Keychain service to repo default", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    process.env.VBR_RUNTIME_HOST = "local-macos";
    await writeRuntimeHostKeychainConfig("viberoots-bootstrap");
    await writeJson("projects/config/local.json", {
      activeRuntimeHost: "local-macos",
    });
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(
      shared.runtimeHosts["local-macos"].service,
      `${path.basename(dir)}-bootstrap`,
    );
  });
});

test("repo bootstrap preserves custom bootstrap Keychain service", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeBootstrapKeychainConfig("custom-bootstrap-service");
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(shared.sprinkleref.categories.bootstrap.service, "custom-bootstrap-service");
  });
});

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

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-resolver-"));
}

const projectConfigDir = () => path.join("projects", "config");
const sharedConfigPath = () => path.join(projectConfigDir(), "shared.json");

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  delete process.env.SPRINKLEREF_CONFIG;
  process.env.VBR_RUNTIME_HOST = "local-file";
  process.env.VBR_INFISICAL_PROJECT_ID = "proj_repo_test";
  process.env.INFISICAL_ACCESS_TOKEN = "admin-token";
  process.env.INFISICAL_CLIENT_ID = "client-id";
  process.env.INFISICAL_CLIENT_SECRET = "client-secret";
  process.env.VBR_VAULT_ADDR = "https://vault.test";
  process.env.VBR_VAULT_TOKEN = "vault-token";
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  globalThis.fetch = fakeRepoBootstrapFetch as typeof fetch;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    process.env = oldEnv;
    globalThis.fetch = oldFetch;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBootstrapKeychainConfig(service: string) {
  await writeJson("projects/config/shared.json", {
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
        bootstrap: { backend: "macos-keychain", service },
      },
    },
  });
}

async function writeRuntimeHostKeychainConfig(service: string) {
  await writeJson("projects/config/shared.json", {
    schemaVersion: "viberoots-project-config@1",
    runtimeHosts: {
      "local-macos": { backend: "macos-keychain", service },
    },
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
      },
    },
  });
}
async function writeGraph(nodes: unknown[]) {
  await writeJson(DEFAULT_GRAPH_PATH, { nodes });
}
