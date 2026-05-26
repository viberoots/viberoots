#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";

test("Infisical deployment bootstrap outputs are managed, not missing", async () => {
  const dir = await gitRepo();
  const managed = "secret://deployments/pleomino/staging/infisical-client-id";
  const missing = "secret://deployments/pleomino/cloudflare_api_token";
  const config = path.join(dir, "resolver.json");
  const store = path.join(dir, "store.json");
  await writeTracked(dir, "contracts.txt", [managed, missing]);
  await fs.writeFile(store, "{}\n");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: store } },
    })}\n`,
  );

  const { exitCode, output } = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--config", config],
      stdout: (text) => (output = text),
    });
    return { exitCode, output };
  });

  assert.equal(exitCode, 1);
  assert.match(output, /Summary: .*managed 1, missing 1/);
  const missingSection = output.slice(
    output.indexOf("Missing values:"),
    output.indexOf("Managed bootstrap outputs:"),
  );
  assert.match(missingSection, /secret:\/\/deployments\/pleomino\/cloudflare_api_token/);
  assert.doesNotMatch(missingSection, /infisical-client-id/);
  assert.match(
    output,
    /Managed bootstrap outputs:[\s\S]*family: pleomino[\s\S]*secret:\/\/deployments\/pleomino\/staging\/infisical-client-id/,
  );
});

test("managed bootstrap outputs do not require a resolver config", async () => {
  const dir = await gitRepo();
  await writeTracked(
    dir,
    "contracts.txt",
    "secret://deployments/pleomino/prod/infisical-client-secret",
  );
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--format", "json"],
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 0);
    return output;
  });
  const report = JSON.parse(output);
  assert.equal(report.summary.managed, 1);
  assert.equal(report.refs[0].status, "managed");
  assert.equal(report.refs[0].managedFamily, "pleomino");
});

test("bootstrap category check ignores application secret refs", async () => {
  const dir = await gitRepo();
  const managed = "secret://deployments/pleomino/prod/infisical-client-id";
  const appSecret = "secret://deployments/pleomino/cloudflare_api_token";
  const config = path.join(dir, "resolver.json");
  const store = path.join(dir, "store.json");
  await writeTracked(dir, "contracts.txt", [managed, appSecret]);
  await fs.writeFile(store, JSON.stringify({ [managed]: "client-id" }));
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: {
        main: { backend: "local-file", file: path.join(dir, "unused.json") },
        bootstrap: { backend: "local-file", file: store },
      },
    })}\n`,
  );

  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--category", "bootstrap", "--config", config],
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 0);
    return output;
  });

  assert.match(output, /Summary: .*present 1, declared 1/);
  assert.doesNotMatch(output, /Missing values:/);
});

async function gitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-managed-"));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function writeTracked(dir: string, file: string, text: string | string[]): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Array.isArray(text) ? `${text.join("\n")}\n` : `${text}\n`);
  await $({ cwd: dir })`git add ${file}`.quiet();
}

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
