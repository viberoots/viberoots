#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
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
        profiles?: Array<{ name: string; needsLiveValidation?: boolean }>;
        bootstrapSink?: { wouldMaterialize?: boolean; wouldValidate?: boolean };
      };
      nextCommands?: unknown;
      credentialSinkDescription?: unknown;
      applicationSecretsManaged?: unknown;
      deploymentProvisioning?: unknown;
      deterministic?: unknown;
      browserAutomation?: unknown;
    };
    assert.equal(report.mode, "repo");
    assert.equal(report.materializationPlan?.readOnly, true);
    assert.equal(report.materializationPlan?.backendLogin?.infisicalRequired, true);
    assert.equal(report.materializationPlan?.backendLogin?.wouldAuthenticate, true);
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
    assert.equal(report.deterministic, undefined);
    assert.equal(report.browserAutomation, undefined);
    assert.match(output.stderr, /Credential sink: .*starter config not created during dry-run/);
    assert.match(output.stderr, /sprinkleref --check --config sprinkleref\/selected\.local\.json/);
    assert.doesNotMatch(output.stdout, /pleomino|opentofu|cloudflare_api_token/);
    await assertMissing("sprinkleref/selected.local.json");
  });
});

test("deployment bootstrap auto credential sink does not create starter resolver config", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    const selection = await resolveCredentialSinkSelection(
      {
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "deployment",
        target: "//projects/deployments/pleomino-staging:deploy",
      },
      {
        platform: "linux",
        env: {},
      },
    );
    assert.match(selection.description, /starter config not created/);
    await assertMissing("sprinkleref/selected.local.json");
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-repo-boundary-"));
}

async function withCwdAndEnv(dir: string, run: () => Promise<void>) {
  const cwd = process.cwd();
  const oldConfig = process.env.SPRINKLEREF_CONFIG;
  delete process.env.SPRINKLEREF_CONFIG;
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(cwd);
    if (oldConfig === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = oldConfig;
  }
}

async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
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
