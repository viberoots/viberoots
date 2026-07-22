#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const load = 'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")';

test("rust macros reject noncanonical Cargo inputs, patch traversal, and unknown attrs", async () => {
  await runInTemp("rust-cargo-input-analysis-errors", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
    const targets = path.join(app, "TARGETS");
    const query = async () =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rustapp:app`;

    await fsp.writeFile(targets, `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"])\n`);
    const missing = await query();
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || missing.stdout), /exactly one package-local Cargo\.toml/);

    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
    await fsp.mkdir(path.join(app, "alternate"));
    await fsp.writeFile(path.join(app, "alternate/Cargo.toml"), "[workspace]\n");
    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_manifest = ["Cargo.toml", "alternate/Cargo.toml"], srcs = ["src/main.rs"])\n`,
    );
    const ambiguous = await query();
    assert.notEqual(ambiguous.exitCode, 0);
    assert.match(
      String(ambiguous.stderr || ambiguous.stdout),
      /cargo_manifest must identify exactly one file/,
    );

    await fsp.writeFile(path.join(app, "Alternate.toml"), "[workspace]\n");
    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_manifest = "Alternate.toml", srcs = ["src/main.rs"])\n`,
    );
    const alternateManifest = await query();
    assert.notEqual(alternateManifest.exitCode, 0);
    assert.match(
      String(alternateManifest.stderr || alternateManifest.stdout),
      /cargo_manifest must be the canonical package-local Cargo\.toml/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_lock = "//projects/libs/shared:Cargo.lock", srcs = ["src/main.rs"])\n`,
    );
    const crossRootLock = await query();
    assert.notEqual(crossRootLock.exitCode, 0);
    assert.match(
      String(crossRootLock.stderr || crossRootLock.stdout),
      /cargo_lock must be the canonical package-local Cargo\.lock/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", local_patch_dirs = ["../shared/patches/rust"], srcs = ["src/main.rs"])\n`,
    );
    const patchTraversal = await query();
    assert.notEqual(patchTraversal.exitCode, 0);
    assert.match(
      String(patchTraversal.stderr || patchTraversal.stdout),
      /local_patch_dirs must remain within the package/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", imaginary_fallback = True, srcs = ["src/main.rs"])\n`,
    );
    const unknown = await query();
    assert.notEqual(unknown.exitCode, 0);
    assert.match(String(unknown.stderr || unknown.stdout), /unknown arguments: imaginary_fallback/);
  });
});
