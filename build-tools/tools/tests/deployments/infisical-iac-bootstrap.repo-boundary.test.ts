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
    const output = await captureStdout(() =>
      runInfisicalIacBootstrap({
        ...DEFAULT_BOOTSTRAP_ARGS,
        mode: "repo",
        dryRun: true,
        yes: false,
      }),
    );
    const report = JSON.parse(output) as { mode: string; resolverConfig: unknown };
    assert.equal(report.mode, "repo");
    assert.ok(report.resolverConfig);
    assert.doesNotMatch(output, /pleomino|opentofu|cloudflare_api_token/);
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

async function captureStdout(run: () => Promise<void>) {
  const original = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}
