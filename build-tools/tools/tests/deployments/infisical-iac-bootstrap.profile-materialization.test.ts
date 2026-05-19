#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { materializeRepoBackendProfiles } from "../../deployments/infisical-iac-bootstrap-profiles";

test("repo profile materialization writes Infisical project id without secret values", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "selected.local.json");
  await writeJson(configPath, starterConfig());
  const api = fakeProjectApi();
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default", "vault-default"],
    api: api as never,
    organizationId: "org_1",
    env: vaultEnv(),
    fetchImpl: fakeVaultFetch as typeof fetch,
  });
  const written = await fs.readFile(configPath, "utf8");
  assert.deepEqual(result.materializedProfiles, ["infisical-default"]);
  assert.match(written, /"projectId": "proj_repo"/);
  assert.doesNotMatch(written, /"clientSecret"|secretValue|pleomino-project-id/);
  assert.deepEqual(api.calls, [
    "GET /api/v1/workspace?organizationId=org_1",
    "POST /api/v1/workspace",
  ]);
});

test("existing Infisical project profile is authoritative and validated without overwrite", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "selected.local.json");
  const config = starterConfig();
  config.profiles["infisical-default"] = {
    ...config.profiles["infisical-default"],
    projectId: "proj_existing",
    projectIdEnv: undefined,
  };
  await writeJson(configPath, config);
  const before = await fs.readFile(configPath, "utf8");
  const api = fakeProjectApi([{ id: "proj_existing", name: "operator-owned" }]);
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default", "vault-default"],
    api: api as never,
    organizationId: "org_1",
    env: vaultEnv(),
    fetchImpl: fakeVaultFetch as typeof fetch,
  });
  assert.deepEqual(result.materializedProfiles, []);
  assert.equal(await fs.readFile(configPath, "utf8"), before);
  assert.deepEqual(api.calls, ["GET /api/v1/workspace?organizationId=org_1"]);
});

test("repo profile validation rejects placeholder Vault metadata", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "selected.local.json");
  await writeJson(configPath, {
    ...starterConfig(),
    profiles: {
      ...starterConfig().profiles,
      "vault-default": {
        backend: "vault",
        address: "fake-vault",
        mount: "secret",
        defaultPath: "/deployments",
        tokenEnv: "VBR_VAULT_TOKEN",
      },
    },
  });
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["vault-default"],
      }),
    /placeholder address|fake/,
  );
});

test("Vault profile validation checks the configured mount", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "selected.local.json");
  await writeJson(configPath, starterConfig());
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["vault-default"],
        env: vaultEnv(),
        fetchImpl: (async () => jsonResponse({ "kv/": { type: "kv" } })) as typeof fetch,
      }),
    /mount secret was not found/,
  );
});

function starterConfig() {
  return {
    version: 1,
    defaultCategory: "main",
    profiles: {
      "infisical-default": {
        backend: "infisical",
        host: "https://app.infisical.com",
        projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
        defaultEnvironment: "staging",
        defaultPath: "/",
        clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
        clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
      },
      "vault-default": {
        backend: "vault",
        addressEnv: "VBR_VAULT_ADDR",
        tokenEnv: "VBR_VAULT_TOKEN",
        mount: "secret",
        defaultPath: "/deployments",
      },
    },
    categories: {
      main: { profile: "infisical-default" },
      bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
    },
  };
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-profile-materialization-"));
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeProjectApi(projects: Array<{ id: string; name: string }> = []) {
  return {
    calls: [] as string[],
    async request(method: string, endpoint: string) {
      this.calls.push(`${method} ${endpoint}`);
      if (method === "GET") return { workspaces: projects };
      return { workspace: { id: "proj_repo", name: "viberoots-deployments" } };
    },
  };
}

function vaultEnv() {
  return { VBR_VAULT_ADDR: "https://vault.test", VBR_VAULT_TOKEN: "vault-token" };
}

async function fakeVaultFetch() {
  return jsonResponse({ "secret/": { type: "kv" } });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
