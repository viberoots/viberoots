#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { buildRepoDryRunMaterializationPlan } from "../../deployments/infisical-iac-bootstrap-dry-run-plan";
import { ensureRepoResolverConfig } from "../../deployments/infisical-iac-bootstrap-resolver";
import { materializeRepoBackendProfiles } from "../../deployments/infisical-iac-bootstrap-profiles";
import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

const VAULT_PROFILE = {
  backend: "vault",
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

test("repo bootstrap skips unused starter backend profiles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    await writeGraph([{ name: "//deployments/app:build" }]);
    const output = await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        yes: true,
      }),
    );
    const report = JSON.parse(output.stdout) as { profiles: string[] };
    const config = await fs.readFile("config/sprinkleref/selected.local.json", "utf8");
    const credentials = await fs.readFile(".local/infisical-bootstrap-credentials.json", "utf8");
    assert.deepEqual(report.profiles, ["infisical-control", "infisical-default"]);
    assert.match(config, /secret:\/\/viberoots\/bootstrap\/viberoots-iac-bootstrap\/client-id/);
    assert.doesNotMatch(config, /secret:\/\/deployments\/pleomino/);
    assert.match(credentials, /secret:\/\/viberoots\/bootstrap\/viberoots-iac-bootstrap/);
    assert.match(credentials, /client-secret/);
  });
});

test("repo dry-run reports active category profile outside graph requirements", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    await writeResolverConfig(inlineInfisicalProfile());
    await writeGraph([{ name: "//deployments/vault:deploy", secret_backend: "vault/default" }]);
    const plan = await buildRepoDryRunMaterializationPlan({
      configPath: "config/sprinkleref/selected.local.json",
      graphPath: path.join("build-tools", "tools", "buck", "graph.json"),
      sink: { kind: "local-file", backend: "local-file", description: "local" },
    });
    const resolver = await ensureRepoResolverConfig({
      dryRun: false,
      configPath: "config/sprinkleref/selected.local.json",
      graphPath: path.join("build-tools", "tools", "buck", "graph.json"),
    });
    assert.deepEqual(
      plan.profiles.map((profile) => profile.name),
      ["infisical-operator", "vault-default"],
    );
    assert.deepEqual(plan.validatedExistingProfiles, ["infisical-operator"]);
    assert.deepEqual(plan.materializedProfiles, []);
    assert.deepEqual(
      resolver.profiles,
      plan.profiles.map((profile) => profile.name),
    );
  });
});

test("category projectIdEnv blockers appear in dry-run and fail confirmed materialization", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    delete process.env.OPERATOR_INFISICAL_PROJECT_ID;
    await writeResolverConfig(projectIdEnvInfisicalProfile());
    await writeGraph([{ name: "//deployments/vault:deploy", secret_backend: "vault/default" }]);
    const before = await fs.readFile("config/sprinkleref/selected.local.json", "utf8");
    const resolver = await ensureRepoResolverConfig({
      dryRun: false,
      configPath: "config/sprinkleref/selected.local.json",
      graphPath: path.join("build-tools", "tools", "buck", "graph.json"),
    });
    const plan = await buildRepoDryRunMaterializationPlan({
      configPath: "config/sprinkleref/selected.local.json",
      graphPath: path.join("build-tools", "tools", "buck", "graph.json"),
      env: {},
      sink: { kind: "local-file", backend: "local-file", description: "local" },
    });
    assert.deepEqual(resolver.profiles, ["infisical-operator", "vault-default"]);
    assert.deepEqual(plan.unresolvedExistingProfiles, ["infisical-operator"]);
    assert.deepEqual(plan.validatedExistingProfiles, []);
    await assert.rejects(
      () =>
        materializeRepoBackendProfiles({
          args: DEFAULT_BOOTSTRAP_ARGS,
          configPath: "config/sprinkleref/selected.local.json",
          requiredProfiles: resolver.profiles,
          api: fakeProjectApi() as never,
          organizationId: "org_1",
          env: {},
        }),
      /projectIdEnv OPERATOR_INFISICAL_PROJECT_ID[\s\S]*unset/,
    );
    assert.equal(await fs.readFile("config/sprinkleref/selected.local.json", "utf8"), before);
  });
});

async function withRepoEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  process.env = {
    ...oldEnv,
    INFISICAL_ACCESS_TOKEN: "admin-token",
    VBR_INFISICAL_PROJECT_ID: "proj_repo_test",
  };
  delete process.env.SPRINKLEREF_CONFIG;
  delete process.env.VBR_VAULT_ADDR;
  delete process.env.VBR_VAULT_TOKEN;
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

async function writeGraph(nodes: unknown[]) {
  await fs.mkdir(path.join("build-tools", "tools", "buck"), { recursive: true });
  await fs.writeFile(
    path.join("build-tools", "tools", "buck", "graph.json"),
    `${JSON.stringify({ nodes }, null, 2)}\n`,
  );
}

async function writeResolverConfig(infisicalProfile: unknown) {
  await writeJson("config/sprinkleref/selected.local.json", {
    version: 1,
    defaultCategory: "main",
    profiles: {
      "vault-default": VAULT_PROFILE,
      "infisical-operator": infisicalProfile,
    },
    categories: {
      main: { profile: "infisical-operator" },
      bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
    },
  });
}

function inlineInfisicalProfile() {
  return {
    backend: "infisical",
    host: "https://infisical.operator.example",
    projectId: "proj_operator",
    defaultEnvironment: "dev",
    defaultPath: "/operator",
    clientIdRef: "secret://operator/infisical/client-id",
    clientSecretRef: "secret://operator/infisical/client-secret",
  };
}

function projectIdEnvInfisicalProfile() {
  return {
    ...inlineInfisicalProfile(),
    projectId: undefined,
    projectIdEnv: "OPERATOR_INFISICAL_PROJECT_ID",
  };
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeProjectApi() {
  return {
    async request() {
      return { workspaces: [] };
    },
  };
}

async function captureConsole(run: () => Promise<void>) {
  const originalLog = console.log;
  const stdout: string[] = [];
  console.log = (value?: unknown) => stdout.push(String(value));
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return { stdout: stdout.join("\n") };
}
