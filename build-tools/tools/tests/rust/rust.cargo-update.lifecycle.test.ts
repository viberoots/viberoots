#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertRustTrackedMetadataReady, repairRustDependencies } from "../../dev/install/cargo";
import { cargoCommandHome } from "../../dev/install/cargo-home";
import {
  addCargoRoot,
  rustUpdateFixture as fixture,
  withCargoEnv,
} from "./rust.cargo-update.fixture";

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
      ["fetch", "--locked"],
      ["metadata", "--offline", "--format-version", "1"],
      ["metadata", "--locked", "--offline", "--format-version", "1"],
      ["update", "--offline"],
      ["metadata", "--locked", "--offline", "--format-version", "1"],
    ]);
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("cold Rust update fetches locked sources without ambient Cargo authority or credential leakage", async () => {
  const value = await fixture();
  const ambientCargoHome = path.join(value.root, "hostile-ambient-cargo-home");
  const toolLog = path.join(value.root, "cargo-tool-identities.log");
  const registryToken = "cold-cache-registry-secret";
  const urlPassword = "cold-cache-url-password";
  try {
    await addCargoRoot(value.root, "cold", "version = 3\n");
    await assert.rejects(
      withCargoEnv(
        {
          CARGO_HOME: ambientCargoHome,
          CARGO_NET_OFFLINE: "false",
          CARGO_REGISTRIES_CRATES_IO_TOKEN: registryToken,
          PATH: path.join(value.root, "hostile-install-path"),
          FAKE_CARGO_LOG: value.log,
          FAKE_CARGO_PROBE_TOOLS: "1",
          FAKE_CARGO_TOOL_LOG: toolLog,
          FAKE_CARGO_FAIL_ROOT: "cold",
          FAKE_CARGO_STDERR: `failed https://fixture:${urlPassword}@registry.example/index token=${registryToken}`,
        },
        async () => await repairRustDependencies(value.root, false, false, value.cargo),
      ),
      (error: Error) => {
        assert.doesNotMatch(error.message, new RegExp(registryToken));
        assert.doesNotMatch(error.message, new RegExp(urlPassword));
        assert.match(error.message, /https:\/\/\[redacted\]@registry\.example/);
        assert.match(error.message, /token=\[redacted\]/);
        return true;
      },
    );
    const [fetch] = (await fsp.readFile(value.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(fetch.args, ["fetch", "--locked"]);
    assert.equal(fetch.cargoHome, cargoCommandHome(value.root));
    assert.equal(fetch.offline, undefined);
    assert.equal(fetch.path, path.dirname(value.cargo));
    assert.equal(fetch.token, undefined);
    assert.deepEqual(
      (await fsp.readFile(toolLog, "utf8")).trim().split("\n"),
      ["rustc", "rustdoc"].map((tool) => path.join(path.dirname(value.cargo), tool)),
    );
    await assert.rejects(fsp.access(ambientCargoHome), /ENOENT/);
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
