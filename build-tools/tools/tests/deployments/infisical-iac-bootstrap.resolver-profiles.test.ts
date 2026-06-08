#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";
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
    const local = await fs.readFile(localConfigPath(), "utf8");
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
const localConfigPath = () => path.join(projectConfigDir(), "local.json");

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  const oldProjectId = process.env.VBR_INFISICAL_PROJECT_ID;
  const oldToken = process.env.INFISICAL_ACCESS_TOKEN;
  const oldVaultAddr = process.env.VBR_VAULT_ADDR;
  const oldVaultToken = process.env.VBR_VAULT_TOKEN;
  const oldRuntimeHost = process.env.VBR_RUNTIME_HOST;
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldLiveRoot = process.env.LIVE_ROOT;
  const oldFetch = globalThis.fetch;
  delete process.env.SPRINKLEREF_CONFIG;
  process.env.VBR_RUNTIME_HOST = "local-file";
  process.env.VBR_INFISICAL_PROJECT_ID = "proj_repo_test";
  process.env.INFISICAL_ACCESS_TOKEN = "admin-token";
  process.env.VBR_VAULT_ADDR = "https://vault.test";
  process.env.VBR_VAULT_TOKEN = "vault-token";
  process.env.WORKSPACE_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  globalThis.fetch = fakeRepoBootstrapFetch as typeof fetch;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
    if (oldProjectId === undefined) delete process.env.VBR_INFISICAL_PROJECT_ID;
    else process.env.VBR_INFISICAL_PROJECT_ID = oldProjectId;
    if (oldToken === undefined) delete process.env.INFISICAL_ACCESS_TOKEN;
    else process.env.INFISICAL_ACCESS_TOKEN = oldToken;
    if (oldVaultAddr === undefined) delete process.env.VBR_VAULT_ADDR;
    else process.env.VBR_VAULT_ADDR = oldVaultAddr;
    if (oldVaultToken === undefined) delete process.env.VBR_VAULT_TOKEN;
    else process.env.VBR_VAULT_TOKEN = oldVaultToken;
    if (oldRuntimeHost === undefined) delete process.env.VBR_RUNTIME_HOST;
    else process.env.VBR_RUNTIME_HOST = oldRuntimeHost;
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldLiveRoot === undefined) delete process.env.LIVE_ROOT;
    else process.env.LIVE_ROOT = oldLiveRoot;
    globalThis.fetch = oldFetch;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
async function writeGraph(nodes: unknown[]) {
  await writeJson(path.join("build-tools", "tools", "buck", "graph.json"), { nodes });
}
