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
import {
  captureConsole,
  escapeRegExp,
  fakeProjectApi,
  generatedInfisicalProfile,
  inlineInfisicalProfile,
  projectIdEnvInfisicalProfile,
  resolverConfig,
  sharedConfigPath,
  withRepoEnv,
  writeGraph,
  writeJson,
  writeResolverConfig,
} from "./infisical-iac-bootstrap.profile-selection.helpers";

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
    const config = await fs.readFile(sharedConfigPath(), "utf8");
    const credentials = await fs.readFile(".local/infisical-bootstrap-credentials.json", "utf8");
    const expectedRef = `secret://bootstrap/${path.basename(dir)}/viberoots-iac-bootstrap/infisical/universal-auth`;
    assert.deepEqual(report.profiles, ["infisical-control"]);
    assert.match(config, new RegExp(`${escapeRegExp(expectedRef)}/client-id`));
    assert.doesNotMatch(config, /secret:\/\/deployments\/sample-webapp/);
    assert.match(credentials, new RegExp(escapeRegExp(expectedRef)));
    assert.match(credentials, /client-secret/);
  });
});

test("repo bootstrap can use configured bootstrap scope for generated credential refs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    await writeGraph([{ name: "//deployments/app:build" }]);
    await writeJson("projects/config/shared.json", {
      sprinkleref: {
        version: 1,
        bootstrapScope: "configured-scope",
        defaultCategory: "main",
        profiles: {
          "infisical-default": generatedInfisicalProfile(),
        },
        categories: {
          main: { profile: "infisical-default" },
          bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
        },
      },
    });
    await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        credentialSink: "local-file",
        yes: true,
      }),
    );
    const credentials = await fs.readFile(".local/infisical-bootstrap-credentials.json", "utf8");
    assert.match(
      credentials,
      new RegExp(
        "secret://bootstrap/configured-scope/viberoots-iac-bootstrap/infisical/universal-auth/client-secret",
      ),
    );
  });
});

test("repo bootstrap CLI scope overrides configured bootstrap scope", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    await writeGraph([{ name: "//deployments/app:build" }]);
    await writeJson("projects/config/shared.json", {
      sprinkleref: {
        version: 1,
        bootstrapScope: "configured-scope",
        defaultCategory: "main",
        profiles: {
          "infisical-default": generatedInfisicalProfile(),
        },
        categories: {
          main: { profile: "infisical-default" },
          bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
        },
      },
    });
    await captureConsole(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        bootstrapCredentialScope: "cli-scope",
        credentialSink: "local-file",
        yes: true,
      }),
    );
    const credentials = await fs.readFile(".local/infisical-bootstrap-credentials.json", "utf8");
    assert.match(
      credentials,
      new RegExp(
        "secret://bootstrap/cli-scope/viberoots-iac-bootstrap/infisical/universal-auth/client-secret",
      ),
    );
    assert.doesNotMatch(credentials, /secret:\/\/bootstrap\/configured-scope/);
  });
});

test("repo dry-run reports active category profile outside graph requirements", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  await withRepoEnv(dir, async () => {
    await writeResolverConfig(inlineInfisicalProfile());
    await writeJson(path.join(dir, ".viberoots", "workspace", "buck", "graph.json"), {
      nodes: [{ name: "//deployments/vault:deploy", secret_backend: "vault/default" }],
    });
    const plan = await buildRepoDryRunMaterializationPlan({
      configPath: "projects/config/shared.json",
      graphPath: path.join(".viberoots", "workspace", "buck", "graph.json"),
      sink: { kind: "local-file", backend: "local-file", description: "local" },
    });
    const resolver = await ensureRepoResolverConfig({
      dryRun: false,
      configPath: "projects/config/shared.json",
      graphPath: path.join(".viberoots", "workspace", "buck", "graph.json"),
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
    const before = await fs.readFile(sharedConfigPath(), "utf8");
    const resolver = await ensureRepoResolverConfig({
      dryRun: false,
      configPath: "projects/config/shared.json",
      graphPath: path.join(".viberoots", "workspace", "buck", "graph.json"),
    });
    const plan = await buildRepoDryRunMaterializationPlan({
      configPath: "projects/config/shared.json",
      graphPath: path.join(".viberoots", "workspace", "buck", "graph.json"),
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
          configPath: "projects/config/shared.json",
          requiredProfiles: resolver.profiles,
          api: fakeProjectApi() as never,
          organizationId: "org_1",
          env: {},
        }),
      /projectIdEnv OPERATOR_INFISICAL_PROJECT_ID[\s\S]*unset/,
    );
    assert.equal(await fs.readFile(sharedConfigPath(), "utf8"), before);
  });
});

test("repo dry-run materialization applies root local overrides from nested cwd", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-profile-selection-"));
  const nested = path.join(dir, "projects", "deployments", "nested");
  await fs.mkdir(nested, { recursive: true });
  await withRepoEnv(nested, async () => {
    await writeJson(path.join(dir, sharedConfigPath()), resolverConfig(inlineInfisicalProfile()));
    await writeJson(path.join(dir, "projects/config/local.json"), {
      sprinkleref: {
        profiles: {
          "infisical-operator": { projectId: "", projectIdEnv: "LOCAL_PROJECT_ID" },
        },
      },
    });
    await writeGraph([{ name: "//deployments/vault:deploy", secret_backend: "vault/default" }]);
    const plan = await buildRepoDryRunMaterializationPlan({
      workspaceRoot: dir,
      configPath: path.join(dir, sharedConfigPath()),
      graphPath: path.join(dir, ".viberoots", "workspace", "buck", "graph.json"),
      env: {},
      sink: { kind: "local-file", backend: "local-file", description: "local" },
    });
    assert.deepEqual(plan.unresolvedExistingProfiles, ["infisical-operator"]);
  });
});
