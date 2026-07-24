#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import handler from "../../patch/patch-rust";
import { rustPatchFilename } from "../../patch/rust-sync-required";

test("Rust start/apply/remove uses package-local source-qualified patches without glue", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-patch-"));
  const oldCwd = process.cwd();
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldOverride = process.env.NIX_RUST_DEV_OVERRIDE_JSON;
  const oldResolve = process.env.NIX_RUST_TEST_RESOLVE_JSON;
  try {
    const cargoRoot = path.join(root, "projects/libs/demo");
    const origin = path.join(root, "fixed-source");
    const source = "registry+https://github.com/rust-lang/crates.io-index";
    await fsp.mkdir(cargoRoot, { recursive: true });
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(root, "flake.nix"), "{}\n");
    await fsp.writeFile(path.join(origin, "lib.rs"), "pub fn value() -> u8 { 1 }\n");
    await fsp.writeFile(
      path.join(origin, ".cargo-checksum.json"),
      JSON.stringify({ package: "fixture", files: {} }),
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.toml"),
      '[package]\nname="demo"\nversion="0.1.0"\n[dependencies]\ndep="1"\n',
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.lock"),
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="fixture"\n`,
    );
    process.env.WORKSPACE_ROOT = root;
    process.env.NIX_RUST_DEV_OVERRIDE_JSON = "{}";
    process.env.NIX_RUST_TEST_RESOLVE_JSON = JSON.stringify({
      [`dep@1.0.0#${source}`]: {
        originPath: origin,
        source,
        checksum: "fixture",
        storePath: origin,
        narHash: "sha256-fixture",
        buildInput: {
          source,
          checksum: "fixture",
          storePath: origin,
          narHash: "sha256-fixture",
        },
      },
    });
    process.chdir(root);
    const args = ["dep", "--importer", "projects/libs/demo"];
    await handler.start(args);
    const store = JSON.parse(await fsp.readFile(path.join(root, ".patch-sessions.json"), "utf8"));
    const record = Object.values(store.sessions.rust)[0] as { workspacePath: string };
    await fsp.writeFile(path.join(record.workspacePath, "lib.rs"), "pub fn value() -> u8 { 2 }\n");
    await handler.apply(args);
    const patch = path.join(cargoRoot, "patches/rust", rustPatchFilename("dep", "1.0.0", source));
    const patchBytes = await fsp.readFile(patch, "utf8");
    assert.match(patchBytes, /value\(\) -> u8 \{ 2 \}/);
    assert.deepEqual(JSON.parse(process.env.NIX_RUST_DEV_OVERRIDE_JSON || "{}"), {});
    await handler.start(args);
    await handler.apply(args);
    assert.equal(await fsp.readFile(patch, "utf8"), patchBytes);
    const afterNoop = JSON.parse(
      await fsp.readFile(path.join(root, ".patch-sessions.json"), "utf8"),
    );
    assert.deepEqual(afterNoop.sessions.rust, {});
    await handler.remove(args);
    await assert.rejects(fsp.access(patch));
  } finally {
    process.chdir(oldCwd);
    for (const [key, value] of [
      ["WORKSPACE_ROOT", oldWorkspaceRoot],
      ["NIX_RUST_DEV_OVERRIDE_JSON", oldOverride],
      ["NIX_RUST_TEST_RESOLVE_JSON", oldResolve],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
});
