#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("Rust remote snapshot overlays the transitive Cargo-root provider closure", async () => {
  await runInTemp("rust-composition-snapshot", async (tmp, $) => {
    const app = path.join(tmp, "projects", "apps", "snapshot_app");
    const core = path.join(tmp, "projects", "libs", "snapshot_core");
    for (const root of [app, core]) await fsp.mkdir(path.join(root, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(core, "Cargo.toml"),
      '[package]\nname="snapshot_core"\nversion="0.1.0"\nedition="2021"\n',
    );
    await fsp.writeFile(
      path.join(core, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="snapshot_core"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(core, "src", "lib.rs"), "pub fn answer() -> i32 { 42 }\n");
    await fsp.writeFile(
      path.join(core, "TARGETS"),
      [
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")',
        'rust_library(name = "core", crate = "snapshot_core", public_crate = "snapshot_core", srcs = ["src/lib.rs"], visibility = ["PUBLIC"])',
        "",
      ].join("\n"),
    );
    const appManifest = [
      "[package]",
      'name="snapshot_app"',
      'version="0.1.0"',
      'edition="2021"',
      "[dependencies]",
      'snapshot_core = { path = "../../libs/snapshot_core", version = "0.1" }',
      "",
    ].join("\n");
    await fsp.writeFile(path.join(app, "Cargo.toml"), appManifest);
    await fsp.writeFile(
      path.join(app, "Cargo.lock"),
      'version = 3\n\n[[package]]\nname="snapshot_app"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(
      path.join(app, "src", "main.rs"),
      'fn main() { println!("{}", snapshot_core::answer()); }\n',
    );
    for (const relative of ["Cargo.toml", "Cargo.lock", "src/main.rs"]) {
      const destination = path.join(app, "remote-src/projects/apps/snapshot_app", relative);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(path.join(app, relative), destination);
    }
    for (const base of ["remote-stale-owner", "remote-missing-owner"]) {
      for (const relative of ["Cargo.toml", "Cargo.lock"]) {
        const destination = path.join(app, base, "projects/apps/snapshot_app", relative);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.copyFile(path.join(app, relative), destination);
      }
    }
    const staleOwner = path.join(app, "remote-stale-owner/projects/apps/snapshot_app/src/main.rs");
    await fsp.mkdir(path.dirname(staleOwner), { recursive: true });
    await fsp.writeFile(staleOwner, 'compile_error!("stale owner source");\n');
    const staleCore = path.join(app, "remote-src/projects/libs/snapshot_core/src/lib.rs");
    await fsp.mkdir(path.dirname(staleCore), { recursive: true });
    await fsp.writeFile(staleCore, "pub fn answer() -> i32 { -1 }\n");
    await fsp.writeFile(path.join(app, "graph.json"), "[]\n");
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
        'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
        "source_snapshot(",
        '  name = "base", graph = "graph.json", srcs = glob(["remote-src/**"]),',
        '  strip_prefix = "remote-src",',
        ")",
        "source_snapshot(",
        '  name = "stale-owner-base", graph = "graph.json",',
        '  srcs = glob(["remote-stale-owner/**"]), strip_prefix = "remote-stale-owner",',
        ")",
        "source_snapshot(",
        '  name = "missing-owner-base", graph = "graph.json",',
        '  srcs = glob(["remote-missing-owner/**"]), strip_prefix = "remote-missing-owner",',
        ")",
        "rust_binary(",
        '  name = "app", crate = "snapshot_app", srcs = ["src/main.rs"],',
        '  deps = ["//projects/libs/snapshot_core:core"], source_snapshot_bundle = ":base",',
        ")",
        "rust_binary(",
        '  name = "app-stale-owner", crate = "snapshot_app", srcs = ["src/main.rs"],',
        '  deps = ["//projects/libs/snapshot_core:core"],',
        '  source_snapshot_bundle = ":stale-owner-base",',
        ")",
        "rust_binary(",
        '  name = "app-missing-owner", crate = "snapshot_app", srcs = ["src/main.rs"],',
        '  deps = ["//projects/libs/snapshot_core:core"],',
        '  source_snapshot_bundle = ":missing-owner-base",',
        ")",
        "",
      ].join("\n"),
    );
    const target = "//projects/apps/snapshot_app:app__rust_composition_snapshot";
    const result = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 build --show-output ${target}
    `;
    const row = String(result.stdout)
      .split("\n")
      .find((line) => line.includes(target));
    assert.ok(row, `missing composition snapshot output: ${String(result.stdout)}`);
    const snapshot = path.resolve(tmp, row.trim().split(/\s+/).at(-1)!);
    assert.equal(
      await fsp.readFile(path.join(snapshot, "projects/apps/snapshot_app/Cargo.toml"), "utf8"),
      appManifest,
    );
    assert.equal(
      await fsp.readFile(path.join(snapshot, "projects/libs/snapshot_core/src/lib.rs"), "utf8"),
      "pub fn answer() -> i32 { 42 }\n",
    );
    assert.equal(
      await fsp.readFile(path.join(snapshot, "projects/libs/snapshot_core/Cargo.toml"), "utf8"),
      '[package]\nname="snapshot_core"\nversion="0.1.0"\nedition="2021"\n',
    );
    const manifestPath = path.join(
      path.dirname(snapshot),
      "app__rust_composition_snapshot.source-snapshot.manifest.json",
    );
    const evidence = JSON.parse(await fsp.readFile(manifestPath, "utf8")).rustComposition;
    assert.deepEqual(
      evidence.manifest.map((entry: { cargo_root: string }) => entry.cargo_root),
      ["projects/apps/snapshot_app", "projects/libs/snapshot_core"],
    );
    assert.deepEqual(
      evidence.manifest.map((entry: { package_id: string }) => entry.package_id),
      ["snapshot_app@0.1.0", "snapshot_core@0.1.0"],
    );
    assert.equal(
      evidence.digest,
      createHash("sha256").update(JSON.stringify(evidence.manifest)).digest("hex"),
    );
    for (const [name, expected] of [
      ["app-stale-owner", /declared snapshot has stale owner source:.*src\/main\.rs/],
      ["app-missing-owner", /declared snapshot is missing required owner source:.*src\/main\.rs/],
    ] as const) {
      const rejected = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        buck2 build //projects/apps/snapshot_app:${name}__rust_composition_snapshot
      `;
      assert.notEqual(rejected.exitCode, 0, `${name} unexpectedly accepted invalid owner bytes`);
      assert.match(`${rejected.stdout}\n${rejected.stderr}`, expected);
    }
  });
});
