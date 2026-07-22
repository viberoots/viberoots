#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

test("rust native build fails closed for invalid source, stale locks, and unsupported sources", async () => {
  await runInTemp("rust-native-fail-closed", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() { invalid rust }\n");
    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\nedition="2021"\n\n[[bin]]\nname="app"\npath="src/main.rs"\n',
    );
    await fsp.writeFile(
      path.join(app, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname = "rustapp"\nversion = "0.1.0"\n',
    );
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")\nrust_binary(name="app", crate="rustapp", srcs=["src/main.rs"])\n',
    );
    await reconcileTempDependencyInputs(tmp, $);
    const build = async () =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 build //projects/apps/rustapp:app`;

    const invalid = await build();
    assert.notEqual(invalid.exitCode, 0);
    assert.match(String(invalid.stderr || invalid.stdout), /invalid|expected|cannot find/i);

    await fsp.writeFile(path.join(app, "src/main.rs"), 'fn main() { println!("ok"); }\n');
    await fsp.appendFile(path.join(app, "Cargo.toml"), '\n[dependencies]\nitoa = "1"\n');
    const stale = await build();
    assert.notEqual(stale.exitCode, 0);
    assert.match(
      String(stale.stderr || stale.stdout),
      /lock file needs to be updated|Cargo\.lock/i,
    );

    await fsp.writeFile(
      path.join(app, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="rustapp"\nversion="0.1.0"\ndependencies=["itoa"]\n\n[[package]]\nname="itoa"\nversion="1.0.0"\nsource = "git+https://example.invalid/itoa#deadbeef"\n',
    );
    const unsupported = await build();
    assert.notEqual(unsupported.exitCode, 0);
    assert.match(String(unsupported.stderr || unsupported.stdout), /unsupported dependency source/);
  });
});
