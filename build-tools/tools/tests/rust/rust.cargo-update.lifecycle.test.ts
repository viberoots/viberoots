#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertRustTrackedMetadataReady, repairRustDependencies } from "../../dev/install/cargo";

async function fixture(): Promise<{ root: string; cargo: string; log: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-update-"));
  const cargo = path.join(root, "fake-cargo");
  const log = path.join(root, "cargo-argv.jsonl");
  await fsp.writeFile(
    cargo,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const args = process.argv.slice(2);",
      "const root = path.basename(process.cwd());",
      'fs.appendFileSync(process.env.FAKE_CARGO_LOG, JSON.stringify({args, root}) + "\\n");',
      "const sleep = Number(process.env.FAKE_CARGO_SLEEP_MS || 0);",
      "if (sleep) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep);",
      "if (process.env.FAKE_CARGO_FAIL_ROOT === root) process.exit(23);",
      'const lock = path.join(process.cwd(), "Cargo.lock");',
      'if (args[0] === "update") fs.writeFileSync(lock, "upgrade\\n");',
      'if (args[0] === "metadata" && !args.includes("--locked")) fs.writeFileSync(lock, "reconciled\\n");',
      'if (args.includes("--locked") && (!fs.existsSync(lock) || fs.readFileSync(lock, "utf8").includes("stale"))) process.exit(24);',
      'process.stdout.write("{}\\n");',
    ].join("\n"),
    { mode: 0o755 },
  );
  return { root, cargo, log };
}

async function addCargoRoot(root: string, name: string, lock?: string): Promise<string> {
  const cargoRoot = path.join(root, "projects", "apps", name);
  await fsp.mkdir(path.join(cargoRoot, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(cargoRoot, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\n`,
  );
  await fsp.writeFile(path.join(cargoRoot, "src", "lib.rs"), "pub fn value() -> u8 { 1 }\n");
  if (lock !== undefined) await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), lock);
  return cargoRoot;
}

function withCargoEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const prior = { ...process.env };
  Object.assign(process.env, env);
  return run().finally(() => {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  });
}

test("repositories without Rust surfaces do not require Cargo", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-no-rust-update-"));
  const priorPath = process.env.PATH;
  try {
    process.env.PATH = "";
    await assertRustTrackedMetadataReady(root);
    assert.equal(await repairRustDependencies(root, false), 0);
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Rust read-only consistency rejects stale Cargo.lock without changing bytes", async () => {
  const value = await fixture();
  try {
    const cargoRoot = await addCargoRoot(value.root, "stale", "stale\n");
    await assert.rejects(
      withCargoEnv(
        { FAKE_CARGO_LOG: value.log },
        async () => await assertRustTrackedMetadataReady(value.root, value.cargo),
      ),
      /tracked metadata is stale:[\s\S]*repair: run u/,
    );
    assert.equal(await fsp.readFile(path.join(cargoRoot, "Cargo.lock"), "utf8"), "stale\n");
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("plain and upgrade Rust updates use exact offline argv in temporary copies", async () => {
  const value = await fixture();
  try {
    const cargoRoot = await addCargoRoot(value.root, "demo", "old\n");
    await withCargoEnv({ FAKE_CARGO_LOG: value.log }, async () => {
      assert.equal(await repairRustDependencies(value.root, false, false, value.cargo), 1);
      assert.equal(await fsp.readFile(path.join(cargoRoot, "Cargo.lock"), "utf8"), "reconciled\n");
      assert.equal(await repairRustDependencies(value.root, false, true, value.cargo), 1);
    });
    assert.equal(await fsp.readFile(path.join(cargoRoot, "Cargo.lock"), "utf8"), "upgrade\n");
    const calls = (await fsp.readFile(value.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).args);
    assert.deepEqual(calls, [
      ["metadata", "--offline", "--format-version", "1"],
      ["metadata", "--locked", "--offline", "--format-version", "1"],
      ["update", "--offline"],
      ["metadata", "--locked", "--offline", "--format-version", "1"],
    ]);
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("multi-root failure restores prior lock bytes and prior absence", async () => {
  const value = await fixture();
  try {
    const one = await addCargoRoot(value.root, "one", "one-before\n");
    const two = await addCargoRoot(value.root, "two");
    await assert.rejects(
      withCargoEnv(
        { FAKE_CARGO_LOG: value.log, FAKE_CARGO_FAIL_ROOT: "two" },
        async () => await repairRustDependencies(value.root, false, false, value.cargo),
      ),
      /exited 23/,
    );
    assert.equal(await fsp.readFile(path.join(one, "Cargo.lock"), "utf8"), "one-before\n");
    await assert.rejects(fsp.access(path.join(two, "Cargo.lock")), /ENOENT/);
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("Rust update timeout leaves the live lock unchanged", async () => {
  const value = await fixture();
  try {
    const cargoRoot = await addCargoRoot(value.root, "timeout", "before\n");
    await assert.rejects(
      withCargoEnv(
        {
          FAKE_CARGO_LOG: value.log,
          FAKE_CARGO_SLEEP_MS: "3000",
          VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS: "1",
        },
        async () => await repairRustDependencies(value.root, false, false, value.cargo),
      ),
      /timed out after 1s/,
    );
    assert.equal(await fsp.readFile(path.join(cargoRoot, "Cargo.lock"), "utf8"), "before\n");
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("Rust update interruption awaits Cargo and leaves the live lock unchanged", async () => {
  const value = await fixture();
  try {
    const cargoRoot = await addCargoRoot(value.root, "interrupt", "before\n");
    const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
    const helper = path.join(value.root, "interrupt-helper.ts");
    await fsp.writeFile(
      helper,
      [
        `import { repairRustDependencies } from ${JSON.stringify(path.join(sourceRoot, "build-tools/tools/dev/install/cargo.ts"))};`,
        "try {",
        `  await repairRustDependencies(${JSON.stringify(value.root)}, false, false, ${JSON.stringify(value.cargo)});`,
        "  process.exit(0);",
        "} catch (error) {",
        "  console.error(String(error));",
        "  process.exit(9);",
        "}",
      ].join("\n"),
    );
    const child = spawn("zx-wrapper", [helper], {
      env: {
        ...process.env,
        FAKE_CARGO_LOG: value.log,
        FAKE_CARGO_SLEEP_MS: "10000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        await fsp.access(value.log).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    child.kill("SIGINT");
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    assert.deepEqual(exit, { code: 9, signal: null });
    assert.equal(await fsp.readFile(path.join(cargoRoot, "Cargo.lock"), "utf8"), "before\n");
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});
