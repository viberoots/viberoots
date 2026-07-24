#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRustSyncRequired, rustPatchFilename } from "../../patch/rust-sync-required";

test("Rust sync-required reports missing/stale deterministically and writes reviewed placeholders", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-sync-"));
  const previousRoot = process.env.WORKSPACE_ROOT;
  const previousCwd = process.cwd();
  try {
    const cargoRoot = path.join(root, "projects/apps/demo");
    const patchDir = path.join(cargoRoot, "custom-patches");
    const crates = "registry+https://github.com/rust-lang/crates.io-index";
    const alternate = "registry+https://registry.example/index";
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(root, "flake.nix"), "{}\n");
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.toml"),
      "[package]\nname='demo'\nversion='1'\n",
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.lock"),
      [
        "version = 3",
        "[[package]]",
        'name = "dep"',
        'version = "1.0.0"',
        `source = "${crates}"`,
        'checksum = "one"',
        "[[package]]",
        'name = "dep"',
        'version = "1.0.0"',
        `source = "${alternate}"`,
        'checksum = "two"',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(
      path.join(patchDir, "required-patches.json"),
      JSON.stringify({
        schema: "viberoots.rust-required-patches.v1",
        required: [{ name: "dep", version: "1.0.0", source: alternate }],
      }),
    );
    process.env.WORKSPACE_ROOT = root;
    process.chdir(root);
    const args = [
      "--importer",
      "projects/apps/demo",
      "--patch-dir",
      "projects/apps/demo/custom-patches",
    ];
    const expected = rustPatchFilename("dep", "1.0.0", alternate);
    await assert.rejects(runRustSyncRequired(args), new RegExp(`missing required Rust patches:`));
    await runRustSyncRequired([...args, "--write-placeholders"]);
    assert.match(await fsp.readFile(path.join(patchDir, expected), "utf8"), /locked source:/);
    await runRustSyncRequired(args);

    await fsp.writeFile(path.join(patchDir, "stale@9--deadbeef.patch"), "stale\n");
    await assert.rejects(
      runRustSyncRequired(args),
      /stale Rust patches:\nstale@9--deadbeef\.patch/,
    );
    await fsp.rm(path.join(patchDir, "stale@9--deadbeef.patch"));

    await fsp.writeFile(
      path.join(patchDir, "required-patches.json"),
      JSON.stringify({
        schema: "viberoots.rust-required-patches.v1",
        required: [{ name: "dep", version: "1.0.0" }],
      }),
    );
    await assert.rejects(runRustSyncRequired(args), /ambiguous required Rust patches:/);
  } finally {
    process.chdir(previousCwd);
    if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = previousRoot;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
