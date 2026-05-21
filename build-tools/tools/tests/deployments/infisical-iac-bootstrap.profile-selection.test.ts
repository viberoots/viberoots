#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInfisicalIacBootstrap } from "../../deployments/infisical-iac-bootstrap";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

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
    const config = await fs.readFile("sprinkleref/selected.local.json", "utf8");
    const credentials = await fs.readFile(".local/infisical-bootstrap-credentials.json", "utf8");
    assert.deepEqual(report.profiles, ["infisical-default"]);
    assert.match(config, /secret:\/\/viberoots\/bootstrap\/viberoots-iac-bootstrap\/client-id/);
    assert.doesNotMatch(config, /secret:\/\/deployments\/pleomino/);
    assert.match(credentials, /secret:\/\/viberoots\/bootstrap\/viberoots-iac-bootstrap/);
    assert.match(credentials, /client-secret/);
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
