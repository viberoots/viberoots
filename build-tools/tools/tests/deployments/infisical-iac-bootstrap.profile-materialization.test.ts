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
  const configPath = path.join(dir, "operator-config.json");
  await writeJson(configPath, starterConfig());
  const api = fakeProjectApi();
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default", "vault-default"],
    api: api as never,
    organizationId: "org_1",
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    env: vaultEnv(),
    fetchImpl: fakeVaultFetch as typeof fetch,
  });
  const written = await fs.readFile(configPath, "utf8");
  assert.deepEqual(result.materializedProfiles, ["infisical-default"]);
  assert.match(written, /"projectId": "proj_repo"/);
  assert.match(written, /"projectName": "fixture-repo"/);
  assert.match(
    written,
    /"clientIdRef": "secret:\/\/bootstrap\/viberoots\/viberoots-iac-bootstrap\/client-id"/,
  );
  assert.doesNotMatch(
    written,
    /secret:\/\/deployments\/sample-webapp|secretValue|sample-webapp-project-id/,
  );
  assert.deepEqual(api.calls, [
    "GET /api/v1/projects?type=secret-manager",
    "POST /api/v1/projects",
    "GET /api/v1/projects/proj_repo/memberships/identities/id_1",
    "POST /api/v1/projects/proj_repo/memberships/identities/id_1",
  ]);
});

test("operator-authored Infisical profile is validated and preserved", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "operator-config.json");
  const config = starterConfig();
  config.profiles["infisical-default"] = {
    backend: "infisical",
    host: "https://infisical.operator.example",
    projectId: "proj_existing",
    projectName: "operator-owned",
    defaultEnvironment: "dev",
    defaultPath: "/custom",
    clientIdRef: "secret://operator/infisical/client-id",
    clientSecretRef: "secret://operator/infisical/client-secret",
  };
  await writeJson(configPath, config);
  const before = await fs.readFile(configPath, "utf8");
  const api = fakeProjectApi([{ id: "proj_existing", name: "operator-owned", orgId: "org_1" }]);
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default", "vault-default"],
    api: api as never,
    organizationId: "org_1",
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    env: vaultEnv(),
    fetchImpl: fakeVaultFetch as typeof fetch,
  });
  assert.deepEqual(result.materializedProfiles, []);
  assert.deepEqual(result.validatedExistingProfiles, ["infisical-default"]);
  assert.equal(await fs.readFile(configPath, "utf8"), before);
  assert.deepEqual(api.calls, [
    "GET /api/v1/projects?type=secret-manager",
    "GET /api/v1/projects/proj_existing/memberships/identities/id_1",
    "POST /api/v1/projects/proj_existing/memberships/identities/id_1",
  ]);
});

test("generated Infisical starter profile with project id is rewritten with repo refs", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "operator-config.json");
  const config = starterConfig();
  config.profiles["infisical-default"] = {
    ...config.profiles["infisical-default"],
    generatedBy: "viberoots-repo-bootstrap",
    projectId: "proj_existing",
    projectIdEnv: undefined,
  };
  await writeJson(configPath, config);
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default"],
    api: fakeProjectApi([{ id: "proj_existing", name: "fixture-repo" }]) as never,
    organizationId: "org_1",
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
  });
  const written = await fs.readFile(configPath, "utf8");
  assert.deepEqual(result.materializedProfiles, ["infisical-default"]);
  assert.deepEqual(result.validatedExistingProfiles, []);
  assert.match(written, /"clientIdRef": "secret:\/\/bootstrap\//);
  assert.doesNotMatch(written, /VBR_INFISICAL_CLIENT_SECRET/);
});

test("operator-authored Infisical project mismatch fails without rewriting", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "operator-config.json");
  const config = starterConfig();
  config.profiles["infisical-default"] = {
    backend: "infisical",
    host: "https://app.infisical.com",
    projectId: "proj_missing",
    defaultEnvironment: "staging",
    clientIdRef: "secret://operator/client-id",
    clientSecretRef: "secret://operator/client-secret",
  };
  await writeJson(configPath, config);
  const before = await fs.readFile(configPath, "utf8");
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["infisical-default"],
        api: fakeProjectApi([{ id: "proj_repo", name: "fixture-repo" }]) as never,
        organizationId: "org_1",
        identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
      }),
    /Infisical project proj_missing was not found/,
  );
  assert.equal(await fs.readFile(configPath, "utf8"), before);
});

test("repo profile validation rejects placeholder Vault metadata", async () => {
  const dir = await tmp();
  const configPath = path.join(dir, "operator-config.json");
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
  const configPath = path.join(dir, "operator-config.json");
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
    repoInfisicalProjectName: "fixture-repo",
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

function fakeProjectApi(projects: Array<{ id: string; name: string; orgId?: string }> = []) {
  return {
    calls: [] as string[],
    async request(
      method: string,
      endpoint: string,
      body?: { projectName?: string },
      allow404?: boolean,
    ) {
      this.calls.push(`${method} ${endpoint}`);
      if (endpoint.includes("/memberships/identities/")) {
        if (method === "GET" && allow404) return undefined;
        return { identityMembership: { id: "membership_1" } };
      }
      if (method === "GET") return { workspaces: projects };
      return {
        project: { id: "proj_repo", name: body?.projectName || "fixture-repo", orgId: "org_1" },
      };
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
