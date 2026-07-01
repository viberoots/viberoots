#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";
import { scanRepositoryRefs } from "../../deployments/sprinkleref-check-scan";

test("scanner discovers deployment refs and skips generated paths", async () => {
  const dir = await gitRepo();
  await writeTracked(dir, "src/contract.txt", [
    "secret://deployments/demo/api_token",
    "config://deployments/demo/public_url",
    "runtime://deployments/demo/github/app_id",
  ]);
  await writeTracked(dir, "node_modules/pkg/ignored.txt", "secret://deployments/demo/ignored");
  const scanned = await scanRepositoryRefs(dir);
  assert.equal(scanned.scannedFiles, 1);
  assert.deepEqual(scanned.refs.map((entry) => entry.ref).sort(), [
    "config://deployments/demo/public_url",
    "runtime://deployments/demo/github/app_id",
    "secret://deployments/demo/api_token",
  ]);
  assert.deepEqual(scanned.refs.find((entry) => entry.scheme === "secret")?.locations, [
    { file: "src/contract.txt", line: 1 },
  ]);
});
test("scanner skips tracked directory symlinks", async () => {
  const dir = await gitRepo();
  await fs.mkdir(path.join(dir, "store-dir"));
  await fs.symlink("store-dir", path.join(dir, "node_modules"));
  await writeTracked(dir, "contracts.txt", "config://deployments/demo/public_url\n");
  await $({ cwd: dir })`git add node_modules`.quiet();
  const scanned = await scanRepositoryRefs(dir);
  assert.equal(scanned.scannedFiles, 1);
  assert.deepEqual(
    scanned.refs.map((entry) => entry.ref),
    ["config://deployments/demo/public_url"],
  );
});
test("scanner skips docs, test fixtures, and placeholder refs", async () => {
  const dir = await gitRepo();
  await writeTracked(dir, "src/contract.txt", "secret://deployments/real/api_token\n");
  await writeTracked(dir, "docs/example.md", "secret://deployments/docs/example\n");
  await writeTracked(dir, "src/placeholder.txt", "secret://deployments/%s/api_token\n");
  await writeTracked(dir, "src/truncated.txt", "config://deployments/\n");
  await writeTracked(dir, "tests/fixture.ts", "secret://deployments/test/api_token\n");
  await writeTracked(dir, "src/example.test.ts", "runtime://deployments/test/app_id\n");
  const scanned = await scanRepositoryRefs(dir);
  assert.deepEqual(
    scanned.refs.map((entry) => entry.ref),
    ["secret://deployments/real/api_token"],
  );
});
test("check reports secret presence without serializing secret values", async () => {
  const dir = await gitRepo();
  const secretRef = "secret://deployments/demo/api_token";
  const missingRef = "secret://deployments/demo/missing";
  const store = path.join(dir, "store.json");
  const config = path.join(dir, "resolver.json");
  await writeTracked(dir, "contracts.txt", [secretRef, missingRef].join("\n"));
  await fs.writeFile(store, `${JSON.stringify({ [secretRef]: "super-secret-value" })}\n`);
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
      argv: ["--check", "--config", config, "--format", "json"],
      stdout: (text) => (output = text),
    });
    return { exitCode, output };
  });
  assert.equal(exitCode, 1);
  assert.doesNotMatch(output, /super-secret-value/);
  const report = JSON.parse(output);
  assert.equal(report.summary.present, 1);
  assert.equal(report.summary.missing, 1);
  assert.equal(report.refs.find((entry: any) => entry.ref === secretRef).sensitive, true);
});
test("check validates non-secret refs as declarations, not secret backend entries", async () => {
  const dir = await gitRepo();
  await writeTracked(
    dir,
    "contracts.txt",
    "config://deployments/demo/public_url\nruntime://deployments/demo/github/app_id\n",
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
  const statuses = JSON.parse(output).refs.map((entry: any) => [entry.scheme, entry.status]);
  assert.deepEqual(statuses, [
    ["config", "declared"],
    ["runtime", "declared"],
  ]);
});

test("check reports unchecked secrets when no resolver config is supplied", async () => {
  const dir = await gitRepo();
  await writeTracked(dir, "contracts.txt", "secret://deployments/demo/api_token\n");
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
  assert.equal(report.refs[0].status, "unchecked");
});
test("check exposes stable usage and resolver access exit codes", async () => {
  await assert.rejects(
    () => runSprinkleRefCheck({ argv: ["--check", "--scheme", "bogus"] }),
    (error: any) => error.exitCode === 3 && /--scheme/.test(error.message),
  );
  const dir = await gitRepo();
  await writeTracked(dir, "contracts.txt", "secret://deployments/demo/api_token\n");
  await assert.rejects(
    () =>
      runInDir(dir, () =>
        runSprinkleRefCheck({ argv: ["--check", "--config", "/missing/resolver.json"] }),
      ),
    (error: any) => {
      assert.equal(error.exitCode, 2);
      assert.match(
        error.message,
        /Project config not found[\s\S]*sprinkleref --init projects\/config[\s\S]*projects\/config\/shared\.json[\s\S]*projects\/config\/local\.json/,
      );
      assert.doesNotMatch(error.message, /config\/sprinkleref/);
      return true;
    },
  );
});
test("check separates invalid refs from unmapped resolver categories", async () => {
  const dir = await gitRepo();
  const config = path.join(dir, "resolver.json");
  await writeTracked(dir, "contracts.txt", "secret://deployments/github/token\n");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "github-actions", scope: "repository" } },
    })}\n`,
  );
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--config", config, "--format", "json"],
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 0);
    return output;
  });
  const report = JSON.parse(output);
  assert.equal(report.refs[0].status, "invalid");
});

test("check reports unmapped refs for missing resolver categories", async () => {
  const dir = await gitRepo();
  const config = path.join(dir, "resolver.json");
  await writeTracked(dir, "contracts.txt", "secret://deployments/demo/prod/infisical-client-id\n");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: "unused.json" } },
    })}\n`,
  );
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--config", config, "--category", "bootstrap", "--format", "json"],
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 1);
    return output;
  });
  assert.equal(JSON.parse(output).refs[0].status, "unmapped");
});

async function gitRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-"));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function writeTracked(dir: string, file: string, text: string | string[]) {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Array.isArray(text) ? `${text.join("\n")}\n` : text);
  await $({ cwd: dir })`git add ${file}`.quiet();
}

async function runInDir<T>(dir: string, fn: () => Promise<T>) {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
