#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { rustPatchFilename } from "../../patch/rust-sync-required";
import { runInTemp } from "../lib/test-helpers";

test("Rust patch-pkg CLI honors target, importer, patch-dir, force, echo, and remove", async () => {
  await runInTemp("rust-patch-cli-flags", async (tmp, $) => {
    const cargoRelative = "projects/libs/demo";
    const cargoRoot = path.join(tmp, cargoRelative);
    const origin = path.join(tmp, "fixed-source");
    const source = "registry+https://registry.example/private-index";
    const key = `dep@1.0.0#${source}`;
    const customDir = `${cargoRelative}/custom/patches`;
    await Promise.all(
      [cargoRoot, origin].map((directory) => fsp.mkdir(directory, { recursive: true })),
    );
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{}\n");
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.toml"),
      '[package]\nname="demo"\nversion="0.1.0"\n[dependencies]\ndep="1"\n',
    );
    await fsp.writeFile(
      path.join(cargoRoot, "Cargo.lock"),
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="fixture"\n`,
    );
    await fsp.writeFile(path.join(origin, "lib.rs"), "pub fn value() -> u8 { 1 }\n");
    await fsp.writeFile(
      path.join(origin, ".cargo-checksum.json"),
      JSON.stringify({ package: "fixture", files: {} }),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
      NIX_RUST_DEV_OVERRIDE_JSON: "{}",
      NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
        [key]: {
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
      }),
    };
    const cli = "viberoots/build-tools/tools/bin/patch-pkg";
    await $`chmod +x ${cli}`;

    const start = await $({
      cwd: tmp,
      env,
      stdio: "pipe",
    })`${cli} start rust dep --target //projects/libs/demo:lib --echo-snippet`;
    const startOutput = `${String(start.stdout || "")}\n${String(start.stderr || "")}`;
    assert.match(startOutput, /export NIX_RUST_DEV_OVERRIDE_JSON=/);
    const sessionStore = path.join(tmp, ".patch-sessions.json");
    const firstStore = JSON.parse(await fsp.readFile(sessionStore, "utf8"));
    const firstWorkspace = firstStore.sessions.rust[key].workspacePath as string;
    await fsp.writeFile(path.join(firstWorkspace, "lib.rs"), "pub fn value() -> u8 { 2 }\n");

    await $({
      cwd: tmp,
      env,
    })`${cli} apply rust dep --importer ${cargoRelative} --patch-dir ${customDir} --force`;
    const patch = path.join(tmp, customDir, rustPatchFilename("dep", "1.0.0", source));
    assert.match(await fsp.readFile(patch, "utf8"), /value\(\) -> u8 \{ 2 \}/);

    await $({ cwd: tmp, env })`${cli} start rust dep --target //projects/libs/demo:lib`;
    const secondStore = JSON.parse(await fsp.readFile(sessionStore, "utf8"));
    const secondWorkspace = secondStore.sessions.rust[key].workspacePath as string;
    await fsp.writeFile(path.join(secondWorkspace, "lib.rs"), "pub fn value() -> u8 { 3 }\n");
    await $({
      cwd: tmp,
      env,
    })`${cli} apply rust dep --target //projects/libs/demo:lib --patch-dir ${customDir} --force`;
    assert.match(await fsp.readFile(patch, "utf8"), /value\(\) -> u8 \{ 3 \}/);

    await $({ cwd: tmp, env })`${cli} start rust dep --importer ${cargoRelative}`;
    const removeStore = JSON.parse(await fsp.readFile(sessionStore, "utf8"));
    const removeWorkspace = removeStore.sessions.rust[key].workspacePath as string;
    await $({
      cwd: tmp,
      env,
    })`${cli} remove rust dep --importer ${cargoRelative} --patch-dir ${customDir}`;
    await assert.rejects(fsp.access(patch));
    await assert.rejects(fsp.access(removeWorkspace));
    const finalStore = JSON.parse(await fsp.readFile(sessionStore, "utf8"));
    assert.deepEqual(finalStore.sessions.rust, {});
  });
});
