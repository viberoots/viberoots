#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCargoPackages } from "../../patch/rust-lock";
import { rustPatchDir } from "../../patch/rust-patch-dir";
import { resolveRustCargoRoot } from "../../patch/rust-root";

test("Rust selection rejects conflicting roots, traversal, symlink escape, and malformed locks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-boundaries-"));
  const previousRoot = process.env.WORKSPACE_ROOT;
  const previousCwd = process.cwd();
  try {
    const one = path.join(root, "projects/apps/one");
    const two = path.join(root, "projects/apps/two");
    const outside = path.join(root, "outside");
    await Promise.all([one, two, outside].map((dir) => fsp.mkdir(dir, { recursive: true })));
    await fsp.writeFile(path.join(root, "flake.nix"), "{}\n");
    for (const cargoRoot of [one, two]) {
      await fsp.writeFile(
        path.join(cargoRoot, "Cargo.toml"),
        "[package]\nname='fixture'\nversion='1'\n",
      );
      await fsp.writeFile(path.join(cargoRoot, "Cargo.lock"), "version=3\n");
    }
    process.env.WORKSPACE_ROOT = root;
    process.chdir(root);
    await assert.rejects(
      resolveRustCargoRoot([
        "--importer",
        "projects/apps/one",
        "--target",
        "//projects/apps/two:two",
      ]),
      /conflicting Cargo roots/,
    );
    await assert.rejects(
      rustPatchDir(one, ["--patch-dir", "../two/patches/rust"]),
      /must remain inside its Cargo root/,
    );
    await fsp.symlink(outside, path.join(one, "escaped"));
    await assert.rejects(
      rustPatchDir(one, ["--patch-dir", "projects/apps/one/escaped/patches"]),
      /must remain inside its Cargo root/,
    );

    const malformed = path.join(one, "Cargo.lock");
    await fsp.writeFile(
      malformed,
      "[[package]]\nname='dep'\nsource='registry+https://registry.example/index'\n",
    );
    await assert.rejects(readCargoPackages(malformed), /name and version are required/);
    await fsp.writeFile(
      malformed,
      "[[package]]\nname='dep'\nversion='1'\nsource='registry+https://registry.example/index'\n",
    );
    await assert.rejects(readCargoPackages(malformed), /registry checksum is required/);
  } finally {
    process.chdir(previousCwd);
    if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = previousRoot;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
