#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cargoManifestAlias,
  cargoSourceHash,
  readCargoPackages,
  selectCargoPackage,
} from "../../patch/rust-lock";
import { rustPatchFilename } from "../../patch/rust-sync-required";

test("Rust patch identities include exact name, version, and locked source", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-lock-"));
  try {
    const lock = path.join(root, "Cargo.lock");
    await fsp.writeFile(
      lock,
      [
        "version = 3",
        "[[package]]",
        'name = "same"',
        'version = "1.0.0"',
        'source = "registry+https://github.com/rust-lang/crates.io-index"',
        'checksum = "abc"',
        "[[package]]",
        'name = "same"',
        'version = "1.0.0"',
        'source = "git+https://example.invalid/same#0123456789abcdef"',
      ].join("\n"),
    );
    const packages = await readCargoPackages(lock);
    const gitHash = cargoSourceHash("git+https://example.invalid/same#0123456789abcdef");
    const registryHash = cargoSourceHash(packages[0]!.source);
    assert.match(gitHash, /^[a-f0-9]{64}$/);
    assert.match(registryHash, /^[a-f0-9]{64}$/);
    assert.notEqual(gitHash, registryHash);
    assert.throws(() => selectCargoPackage(packages, "same"), /ambiguous/);
    const git = selectCargoPackage(packages, "same", "1.0.0", gitHash);
    const registry = packages[0]!;
    assert.notEqual(
      rustPatchFilename(git.name, git.version, git.source),
      rustPatchFilename(registry.name, registry.version, registry.source),
    );
    assert.match(rustPatchFilename(git.name, git.version, git.source), /--[a-f0-9]{64}\.patch$/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Rust patch requests resolve renamed manifest dependencies", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-alias-"));
  try {
    const manifest = path.join(root, "Cargo.toml");
    await fsp.writeFile(
      manifest,
      [
        "[dependencies]",
        'inline = { package = "inline-crate", version = "1" }',
        "[dependencies.renamed]",
        'package = "actual-crate"',
        'version = "1"',
        "[target.'cfg(unix)'.dependencies.target-renamed]",
        'package = "target-crate"',
        'version = "2"',
      ].join("\n"),
    );
    const packages = [
      {
        name: "actual-crate",
        version: "1.0.0",
        source: "registry+https://registry.example/index",
        checksum: "actual",
      },
      {
        name: "target-crate",
        version: "2.0.0",
        source: "registry+https://registry.example/index",
        checksum: "target",
      },
    ];
    assert.equal(await cargoManifestAlias(manifest, "inline"), "inline-crate");
    assert.equal(await cargoManifestAlias(manifest, "renamed"), "actual-crate");
    assert.equal(
      selectCargoPackage(packages, await cargoManifestAlias(manifest, "renamed")).version,
      "1.0.0",
    );
    assert.equal(await cargoManifestAlias(manifest, "target-renamed"), "target-crate");
    assert.equal(
      selectCargoPackage(packages, await cargoManifestAlias(manifest, "target-renamed")).version,
      "2.0.0",
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
