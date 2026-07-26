#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { copyCargoRoot } from "../../dev/install/cargo-root-copy";

test("Cargo copies include workspace members and exclude unrelated roots", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-cross-root-copy-"));
  try {
    const app = path.join(workspace, "projects/apps/app");
    const library = path.join(workspace, "projects/libs/core");
    const unrelated = path.join(workspace, "projects/libs/unrelated");
    const nested = path.join(app, "crates/nested");
    const excluded = path.join(app, "crates/unrelated");
    for (const [root, name] of [
      [app, "app"],
      [library, "core"],
      [nested, "nested"],
    ]) {
      await fsp.mkdir(path.join(root, "src"), { recursive: true });
      await fsp.writeFile(
        path.join(root, "Cargo.toml"),
        `[package]\nname="${name}"\nversion="0.1.0"\n`,
      );
      await fsp.writeFile(path.join(root, "src/lib.rs"), "");
    }
    await fsp.appendFile(
      path.join(app, "Cargo.toml"),
      [
        "",
        "[workspace]",
        'members = ["crates/*"]',
        'exclude = ["crates/unrelated"]',
        "[dependencies]",
        'core = { path = "../../libs/core" }',
        "",
      ].join("\n"),
    );
    await fsp.mkdir(excluded, { recursive: true });
    await fsp.writeFile(
      path.join(excluded, "Cargo.toml"),
      '[package]\nname="excluded"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(excluded, "Cargo.lock"), "unrelated lock\n");
    await fsp.symlink(path.dirname(process.execPath), path.join(excluded, "external-tool"));
    await fsp.mkdir(unrelated, { recursive: true });
    await fsp.writeFile(
      path.join(unrelated, "Cargo.toml"),
      '[package]\nname="unrelated"\nversion="0.1.0"\n',
    );
    await fsp.symlink(path.dirname(process.execPath), path.join(unrelated, "external-tool"));
    const copy = await copyCargoRoot(app, workspace);
    try {
      assert.equal(
        await fsp.readFile(path.join(copy.root, "Cargo.toml"), "utf8"),
        await fsp.readFile(path.join(app, "Cargo.toml"), "utf8"),
      );
      assert.equal(
        await fsp.readFile(path.resolve(copy.root, "../../libs/core/Cargo.toml"), "utf8"),
        await fsp.readFile(path.join(library, "Cargo.toml"), "utf8"),
      );
      assert.equal(
        await fsp.readFile(path.join(copy.root, "crates/nested/Cargo.toml"), "utf8"),
        await fsp.readFile(path.join(nested, "Cargo.toml"), "utf8"),
      );
      await assert.rejects(
        fsp.access(path.join(copy.root, "crates/unrelated/Cargo.toml")),
        /ENOENT/,
      );
      await assert.rejects(
        fsp.access(path.resolve(copy.root, "../../libs/unrelated/Cargo.toml")),
        /ENOENT/,
      );
    } finally {
      await copy.cleanup();
    }
    await fsp.symlink(path.dirname(process.execPath), path.join(app, "external-tool"));
    await assert.rejects(
      copyCargoRoot(app, workspace),
      /Cargo temporary copy rejects external symlink/,
    );
    await fsp.unlink(path.join(app, "external-tool"));
    await fsp.symlink(path.dirname(process.execPath), path.join(workspace, "linked-dependency"));
    await fsp.appendFile(
      path.join(app, "Cargo.toml"),
      '\n[build-dependencies]\nlinked = { path = "../../../linked-dependency" }\n',
    );
    await assert.rejects(
      copyCargoRoot(app, workspace),
      /Cargo path dependency root traverses a symlink/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});
