#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildRepoDryRunMaterializationPlan } from "../../deployments/infisical-iac-bootstrap-dry-run-plan";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { materializeRepoBackendProfiles } from "../../deployments/infisical-iac-bootstrap-profiles";

test("operator-authored projectIdEnv profile is validated and preserved when env resolves", async () => {
  const configPath = await writeProfileConfig(operatorProjectIdEnvProfile());
  const before = await fs.readFile(configPath, "utf8");
  const api = fakeProjectApi([{ id: "proj_env", name: "operator-env-project", orgId: "org_1" }]);
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default"],
    api: api as never,
    organizationId: "org_1",
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    env: { OPERATOR_INFISICAL_PROJECT_ID: "proj_env" },
  });
  assert.deepEqual(result.materializedProfiles, []);
  assert.deepEqual(result.validatedExistingProfiles, ["infisical-default"]);
  assert.equal(await fs.readFile(configPath, "utf8"), before);
  assert.deepEqual(api.calls, [
    "GET /api/v1/projects?type=secret-manager",
    "GET /api/v1/projects/proj_env/memberships/identities/id_1",
    "POST /api/v1/projects/proj_env/memberships/identities/id_1",
  ]);
});

test("historical env profile with extra metadata is preserved", async () => {
  const configPath = await writeProfileConfig(historicalEnvProfileWithOperatorFields());
  const before = await fs.readFile(configPath, "utf8");
  const result = await materializeRepoBackendProfiles({
    args: DEFAULT_BOOTSTRAP_ARGS,
    configPath,
    requiredProfiles: ["infisical-default"],
    api: fakeProjectApi([
      { id: "proj_env", name: "operator-env-project", orgId: "org_1" },
    ]) as never,
    organizationId: "org_1",
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    env: { VBR_INFISICAL_PROJECT_ID: "proj_env" },
  });
  assert.deepEqual(result.materializedProfiles, []);
  assert.deepEqual(result.validatedExistingProfiles, ["infisical-default"]);
  assert.equal(await fs.readFile(configPath, "utf8"), before);
});

test("operator-authored projectIdEnv profile fails closed when env is unset", async () => {
  const configPath = await writeProfileConfig(operatorProjectIdEnvProfile());
  const before = await fs.readFile(configPath, "utf8");
  const api = fakeProjectApi([{ id: "proj_env", name: "operator-env-project" }]);
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["infisical-default"],
        api: api as never,
        organizationId: "org_1",
        identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
        env: {},
      }),
    /projectIdEnv OPERATOR_INFISICAL_PROJECT_ID[\s\S]*unset/,
  );
  assert.equal(await fs.readFile(configPath, "utf8"), before);
  assert.deepEqual(api.calls, []);
});

test("operator-authored profile org mismatch fails without rewriting", async () => {
  const configPath = await writeProfileConfig(operatorInlineProjectProfile());
  const before = await fs.readFile(configPath, "utf8");
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["infisical-default"],
        api: fakeProjectApi([
          { id: "proj_existing", name: "operator-owned", orgId: "org_elsewhere" },
        ]) as never,
        organizationId: "org_1",
        identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
      }),
    /project proj_existing belongs to organization org_elsewhere, not selected organization org_1/,
  );
  assert.equal(await fs.readFile(configPath, "utf8"), before);
});

test("operator-authored profile missing org proof fails without rewriting", async () => {
  const configPath = await writeProfileConfig(operatorInlineProjectProfile());
  const before = await fs.readFile(configPath, "utf8");
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["infisical-default"],
        api: fakeProjectApi([{ id: "proj_existing", name: "operator-owned" }]) as never,
        organizationId: "org_1",
        identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
      }),
    /project proj_existing did not include organization evidence/,
  );
  assert.equal(await fs.readFile(configPath, "utf8"), before);
});

test("dry-run and confirmed bootstrap both block unresolved projectIdEnv operator profiles", async () => {
  const configPath = await writeProfileConfig(operatorProjectIdEnvProfile());
  const graphPath = await writeGraphConfig(configPath);
  const plan = await buildRepoDryRunMaterializationPlan({
    configPath,
    env: {},
    graphPath,
    sink: { kind: "local-file", backend: "local-file", description: "local" },
  });
  assert.deepEqual(plan.validatedExistingProfiles, []);
  assert.deepEqual(plan.materializedProfiles, []);
  assert.deepEqual(plan.unresolvedExistingProfiles, ["infisical-default"]);
  assert.deepEqual(profileValidationStates(plan), [
    { name: "infisical-default", unresolvedProjectIdEnv: true, validationBlocked: true },
  ]);
  await assert.rejects(
    () =>
      materializeRepoBackendProfiles({
        args: DEFAULT_BOOTSTRAP_ARGS,
        configPath,
        requiredProfiles: ["infisical-default"],
        api: fakeProjectApi() as never,
        organizationId: "org_1",
        env: {},
      }),
    /projectIdEnv OPERATOR_INFISICAL_PROJECT_ID[\s\S]*unset/,
  );
});

test("dry-run validates projectIdEnv operator profiles when env resolves", async () => {
  const configPath = await writeProfileConfig(operatorProjectIdEnvProfile());
  const graphPath = await writeGraphConfig(configPath);
  const plan = await buildRepoDryRunMaterializationPlan({
    configPath,
    env: { OPERATOR_INFISICAL_PROJECT_ID: "proj_env" },
    graphPath,
    sink: { kind: "local-file", backend: "local-file", description: "local" },
  });
  assert.deepEqual(plan.validatedExistingProfiles, ["infisical-default"]);
  assert.deepEqual(plan.materializedProfiles, []);
  assert.deepEqual(plan.unresolvedExistingProfiles, []);
  assert.deepEqual(profileValidationStates(plan), [
    { name: "infisical-default", unresolvedProjectIdEnv: false, validationBlocked: false },
  ]);
});

function profileValidationStates(
  plan: Awaited<ReturnType<typeof buildRepoDryRunMaterializationPlan>>,
) {
  return plan.profiles.map(({ name, unresolvedProjectIdEnv, validationBlocked }) => ({
    name,
    unresolvedProjectIdEnv,
    validationBlocked,
  }));
}

async function writeProfileConfig(profile: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-profile-env-"));
  const configPath = path.join(dir, "operator-config.json");
  await writeJson(configPath, {
    version: 1,
    defaultCategory: "main",
    profiles: { "infisical-default": profile },
    categories: {
      main: { profile: "infisical-default" },
      bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
    },
  });
  return configPath;
}

async function writeGraphConfig(configPath: string) {
  const graphPath = path.join(path.dirname(configPath), "graph.json");
  await writeJson(graphPath, {
    nodes: [{ name: "//deployments/infisical:deploy", secret_backend: "infisical/default" }],
  });
  return graphPath;
}

function operatorProjectIdEnvProfile() {
  return {
    backend: "infisical",
    host: "https://infisical.operator.example",
    projectIdEnv: "OPERATOR_INFISICAL_PROJECT_ID",
    defaultEnvironment: "dev",
    defaultPath: "/operator",
    clientIdRef: "secret://operator/infisical/client-id",
    clientSecretRef: "secret://operator/infisical/client-secret",
  };
}

function operatorInlineProjectProfile() {
  return {
    backend: "infisical",
    host: "https://infisical.operator.example",
    projectId: "proj_existing",
    projectName: "operator-owned",
    defaultEnvironment: "dev",
    defaultPath: "/operator",
    clientIdRef: "secret://operator/infisical/client-id",
    clientSecretRef: "secret://operator/infisical/client-secret",
  };
}

function historicalEnvProfileWithOperatorFields() {
  return {
    backend: "infisical",
    host: "https://app.infisical.com",
    projectIdEnv: "VBR_INFISICAL_PROJECT_ID",
    defaultEnvironment: "staging",
    defaultPath: "/",
    clientIdEnv: "VBR_INFISICAL_CLIENT_ID",
    clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET",
    clientIdRef: "secret://operator/custom-client-id",
    clientSecretRef: "secret://operator/custom-client-secret",
    namespace: "operator-namespace",
  };
}

async function writeJson(file: string, value: unknown) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeProjectApi(projects: Array<{ id: string; name: string; orgId?: string }> = []) {
  return {
    calls: [] as string[],
    async request(method: string, endpoint: string, _body?: unknown, allow404?: boolean) {
      this.calls.push(`${method} ${endpoint}`);
      if (endpoint.includes("/memberships/identities/")) {
        if (method === "GET" && allow404) return undefined;
        return { identityMembership: { id: "membership_1" } };
      }
      return { workspaces: projects };
    },
  };
}
