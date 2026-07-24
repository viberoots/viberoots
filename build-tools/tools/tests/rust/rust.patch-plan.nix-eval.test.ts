#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cargoSourceHash } from "../../patch/rust-lock";
import { runInTemp } from "../lib/test-helpers";

test("Rust Nix patch plan selects the exact locked source and rejects stale inventory", async () => {
  await runInTemp("rust-patch-plan", async (tmp, $) => {
    const cargoRoot = path.join(tmp, "projects/libs/demo");
    const patchDir = path.join(cargoRoot, "patches/rust");
    const vendorAuthority = path.join(cargoRoot, "vendor-authority");
    const source = "registry+https://github.com/rust-lang/crates.io-index";
    const key = `dep@1.0.0#${source}`;
    const filename = `dep@1.0.0--${cargoSourceHash(source)}.patch`;
    await Promise.all(
      [patchDir, vendorAuthority].map((directory) => fsp.mkdir(directory, { recursive: true })),
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.lock"),
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="fixture"\n`,
    );
    await fsp.writeFile(path.join(patchDir, filename), "diff --git a/lib.rs b/lib.rs\n");
    const expression = (includeAuthority = true) => `
      let
        pkgs = import <nixpkgs> {};
        plan = import ./viberoots/build-tools/tools/nix/templates/rust-patches.nix {
          inherit pkgs;
          cargoLock = builtins.toPath ${JSON.stringify(path.join(cargoRoot, "Cargo.lock"))};
          patchInputs = [ (builtins.toPath ${JSON.stringify(patchDir)}) ];
          vendorAuthorities = ${
            includeAuthority
              ? `{ ${JSON.stringify(key)} = builtins.toPath ${JSON.stringify(vendorAuthority)}; }`
              : "{}"
          };
        };
      in {
        records = map (record: {
          inherit (record) name version source checksum;
          patch = builtins.toString record.patch;
        }) plan.records;
        inherit (plan) postPatch;
      }
    `;
    const selected = await $({ cwd: tmp, stdio: "pipe" })`
      nix eval --impure --expr ${expression()} --json
    `;
    const evaluated = JSON.parse(String(selected.stdout || "{}"));
    assert.deepEqual(evaluated.records, [
      {
        name: "dep",
        version: "1.0.0",
        source,
        checksum: "fixture",
        patch: path.join(patchDir, filename),
      },
    ]);
    assert.match(evaluated.postPatch, /\/bin\/diff -qr/);
    for (const excluded of [
      ".cargo-checksum.json",
      ".cargo-config",
      ".cargo_vcs_info.json",
      ".git",
    ]) {
      assert.ok(evaluated.postPatch.includes(`--exclude=${excluded}`));
    }
    assert.match(evaluated.postPatch, /expected one exact vendored identity/);

    const missingAuthority = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`
      nix eval --impure --expr ${expression(false)} --json
    `;
    assert.notEqual(missingAuthority.exitCode, 0);
    assert.match(String(missingAuthority.stderr), /source authority is unavailable/);

    await fsp.writeFile(path.join(patchDir, "stale@9.0.0--deadbeef.patch"), "stale\n");
    const stale = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
      nix eval --impure --expr ${expression()} --json
    `;
    assert.notEqual(stale.exitCode, 0);
    assert.match(String(stale.stderr), /stale or ambiguous entries/);
  });
});

test("Rust vendor template cannot alias same-package Git source identities", async () => {
  await runInTemp("rust-patch-authorities", async (tmp, $) => {
    const cargoRoot = path.join(tmp, "fixture");
    const lock = path.join(cargoRoot, "Cargo.lock");
    const sources = ["a", "b"].map(
      (revision) => `git+https://git.example/dep?branch=${revision}#${revision.repeat(40)}`,
    );
    await fsp.mkdir(cargoRoot);
    await fsp.writeFile(
      lock,
      [
        "version=3",
        '[[package]]\nname="fixture"\nversion="0.1.0"',
        ...sources.map((source) => `[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"`),
        "",
      ].join("\n"),
    );
    const fixedSources: Record<string, unknown> = {};
    for (const [index, source] of sources.entries()) {
      const packageRoot = path.join(tmp, `dep-${index}`);
      await fsp.mkdir(packageRoot);
      await fsp.writeFile(
        path.join(packageRoot, "Cargo.toml"),
        `[package]\nname="dep"\nversion="1.0.0"\n`,
      );
      const added = await $({ cwd: tmp, stdio: "pipe" })`
        nix store add-path --name ${`git-dep-${index}`} ${packageRoot}
      `;
      const storePath = String(added.stdout).trim();
      const hashed = await $({ cwd: tmp, stdio: "pipe" })`
        nix hash path --sri ${storePath}
      `;
      fixedSources[`dep@1.0.0#${source}`] = {
        source,
        checksum: "",
        storePath,
        narHash: String(hashed.stdout).trim(),
      };
    }
    const expression = `
      let
        pkgs = import <nixpkgs> {};
        vendor =
          import ./viberoots/build-tools/tools/nix/templates/rust-vendor.nix {
          inherit pkgs;
          cargoRoot = builtins.toPath ${JSON.stringify(cargoRoot)};
          cargoLock = builtins.toPath ${JSON.stringify(lock)};
          cargoFixedSources = builtins.fromJSON ${JSON.stringify(JSON.stringify(fixedSources))};
        };
      in {
        inherit (vendor) sourceIdentities vendorAuthorities vendorDestinations;
      }
    `;
    const result = await $({ cwd: tmp, stdio: "pipe" })`
      nix eval --impure --json --expr ${expression}
    `;
    const evaluated = JSON.parse(String(result.stdout || "{}")) as {
      sourceIdentities: Record<string, { hash: string; replacement: string; directory: string }>;
      vendorAuthorities: Record<string, string>;
      vendorDestinations: Record<string, string>;
    };
    const authorities = evaluated.vendorAuthorities;
    assert.deepEqual(Object.keys(authorities).sort(), [
      `dep@1.0.0#${sources[0]}`,
      `dep@1.0.0#${sources[1]}`,
    ]);
    assert.notEqual(
      authorities[Object.keys(authorities)[0]!],
      authorities[Object.keys(authorities)[1]!],
    );
    const hashes = sources.map((source) => cargoSourceHash(source));
    for (const [index, source] of sources.entries()) {
      const hash = hashes[index]!;
      const identity = evaluated.sourceIdentities[source]!;
      const key = `dep@1.0.0#${source}`;
      assert.match(hash, /^[a-f0-9]{64}$/);
      assert.deepEqual(identity, {
        hash,
        replacement: `viberoots-${hash}`,
        directory: hash,
      });
      assert.equal(evaluated.vendorDestinations[key], `${hash}/dep-1.0.0`);
    }
    assert.notEqual(hashes[0], hashes[1]);
    assert.notEqual(
      evaluated.sourceIdentities[sources[0]!]!.replacement,
      evaluated.sourceIdentities[sources[1]!]!.replacement,
    );
    assert.notEqual(
      evaluated.vendorDestinations[`dep@1.0.0#${sources[0]}`],
      evaluated.vendorDestinations[`dep@1.0.0#${sources[1]}`],
    );
  });
});
