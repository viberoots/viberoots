#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { buildRepoDryRunMaterializationPlan } from "../../deployments/infisical-iac-bootstrap-dry-run-plan";
import { resolveCredentialSinkSelection } from "../../deployments/infisical-iac-bootstrap-sink";

test("repo bootstrap dry-run reports resolver profiles without Pleomino provisioning", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    let fetchCalled = false;
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("dry-run must not call backend APIs");
    }) as typeof fetch;
    const output = await captureConsole(async () => {
      try {
        await runInfisicalIacBootstrap({
          ...DEFAULT_BOOTSTRAP_ARGS,
          mode: "repo",
          dryRun: true,
          yes: false,
        });
      } finally {
        globalThis.fetch = oldFetch;
      }
    });
    const report = JSON.parse(output.stdout) as {
      mode: string;
      materializationPlan?: {
        readOnly?: boolean;
        backendLogin?: { infisicalRequired?: boolean; wouldAuthenticate?: boolean };
        materializedProfiles?: string[];
        validatedExistingProfiles?: string[];
        profiles?: Array<{ name: string; needsLiveValidation?: boolean }>;
        bootstrapSink?: { wouldMaterialize?: boolean; wouldValidate?: boolean };
      };
      nextCommands?: unknown;
      credentialSinkDescription?: unknown;
      applicationSecretsManaged?: unknown;
      deploymentProvisioning?: unknown;
      deploymentFanOut?: {
        readOnly?: boolean;
        optOutFlag?: string;
        offeredTargets?: string[];
      };
      deterministic?: unknown;
      browserAutomation?: unknown;
    };
    assert.equal(report.mode, "repo");
    assert.equal(report.materializationPlan?.readOnly, true);
    assert.equal(report.materializationPlan?.backendLogin?.infisicalRequired, true);
    assert.equal(report.materializationPlan?.backendLogin?.wouldAuthenticate, true);
    assert.deepEqual(report.materializationPlan?.materializedProfiles, ["infisical-default"]);
    assert.deepEqual(report.materializationPlan?.validatedExistingProfiles, []);
    assert.ok(report.materializationPlan?.profiles?.some((profile) => profile.needsLiveValidation));
    assert.equal(
      Boolean(
        report.materializationPlan?.bootstrapSink?.wouldMaterialize ||
          report.materializationPlan?.bootstrapSink?.wouldValidate,
      ),
      true,
    );
    assert.equal(fetchCalled, false);
    assert.equal(report.nextCommands, undefined);
    assert.equal(report.credentialSinkDescription, undefined);
    assert.equal(report.applicationSecretsManaged, undefined);
    assert.equal(report.deploymentProvisioning, undefined);
    assert.equal(report.deploymentFanOut?.readOnly, true);
    assert.equal(report.deploymentFanOut?.optOutFlag, "--without-deployments");
    assert.deepEqual(report.deploymentFanOut?.offeredTargets, []);
    assert.equal(report.deterministic, undefined);
    assert.equal(report.browserAutomation, undefined);
    assert.match(output.stderr, /Credential sink: .*starter config not created during dry-run/);
    assert.match(output.stderr, /sprinkleref --check --config projects\/config\/shared\.json/);
    assert.doesNotMatch(output.stdout, /pleomino|opentofu|cloudflare_api_token/);
    assert.doesNotMatch(output.stderr, /pleomino|opentofu|--tofu-dir|cloudflare_api_token/i);
    await assertMissing("projects/config/shared.json");
  });
});

test("deployment bootstrap auto credential sink does not create starter resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const selection = await resolveCredentialSinkSelection(
      {
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "deployment",
        target: "//projects/deployments/pleomino/staging:deploy",
      },
      {
        platform: "linux",
        env: {},
      },
    );
    assert.match(selection.description, /starter config not created/);
    await assertMissing("projects/config/shared.json");
  });
});

test("repo bootstrap dry-run reports preserved operator profiles separately", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeJson("projects/config/shared.json", resolverConfig("infisical-default", "operator"));
    await writeJson("graph.json", {
      nodes: [{ name: "//deployments/infisical:deploy", secret_backend: "infisical/default" }],
    });
    const plan = await buildRepoDryRunMaterializationPlan({
      configPath: "projects/config/shared.json",
      graphPath: "graph.json",
      sink: {
        kind: "projects/config",
        backend: "local-file",
        category: "bootstrap",
        description: "test sink",
      },
    });
    assert.deepEqual(plan.validatedExistingProfiles, ["infisical-default"]);
    assert.deepEqual(plan.materializedProfiles, []);
  });
});

test("repo bootstrap dry-run reads resolver config from workspace root from nested cwd", async () => {
  const dir = await tmp();
  const nested = path.join(dir, "projects", "deployments", "nested");
  await fs.mkdir(nested, { recursive: true });
  await withCwdAndEnv(nested, async () => {
    await writeJson(
      path.join(dir, "projects/config/shared.json"),
      resolverConfig("infisical-root", "root"),
    );
    await writeJson(
      path.join(nested, "projects/config/shared.json"),
      resolverConfig("infisical-nested", "nested"),
    );
    await writeJson(path.join(dir, ".viberoots/workspace/buck/graph.json"), {
      nodes: [{ name: "//deployments/app:build" }],
    });
    const sink = await resolveCredentialSinkSelection({
      ...DEFAULT_BOOTSTRAP_ARGS,
      mode: "repo",
    });
    const plan = await buildRepoDryRunMaterializationPlan({ sink });
    assert.deepEqual(
      plan.profiles.map((profile) => profile.name),
      ["infisical-root"],
    );
    assert.equal(plan.resolverConfig.path, path.join(dir, "projects/config/shared.json"));
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-repo-boundary-"));
}

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  delete process.env.SPRINKLEREF_CONFIG;
  process.env.WORKSPACE_ROOT = workspaceRootForTemp(dir);
  process.env._VIBEROOTS_DEVSHELL_ROOT = workspaceRootForTemp(dir);
  process.env.LIVE_ROOT = workspaceRootForTemp(dir);
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    process.env = oldEnv;
  }
}

function workspaceRootForTemp(dir: string) {
  const marker = `${path.sep}projects${path.sep}deployments${path.sep}`;
  const markerIndex = dir.indexOf(marker);
  return markerIndex >= 0 ? dir.slice(0, markerIndex) : dir;
}

function resolverConfig(profile: string, prefix: string) {
  return {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "main",
      profiles: {
        [profile]: {
          backend: "infisical",
          host: `https://infisical.${prefix}.example`,
          projectId: `proj_${prefix}`,
          defaultEnvironment: "dev",
          clientIdRef: `secret://${prefix}/client-id`,
          clientSecretRef: `secret://${prefix}/client-secret`,
        },
      },
      categories: {
        main: { profile },
        bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
      },
    },
  };
}

async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function captureConsole(run: () => Promise<void>) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (value?: unknown) => {
    stdout.push(String(value));
  };
  console.error = (value?: unknown) => {
    stderr.push(String(value));
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
