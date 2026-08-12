#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertCargoConfigIsolation,
  assertRustTrackedMetadataReady,
  repairRustDependencies,
} from "../../dev/install/cargo";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const nixSourcePolicy = path.join(sourceRoot, "build-tools/rust/cargo-source-policy.nix");
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());
const artifactToolsRoot = canonicalArtifactToolsRoot(
  workspaceRoot,
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
const nixInstantiate = ensureNixStoreToolPathSync("nix-instantiate", {
  PATH: path.join(artifactToolsRoot, "bin"),
});

async function cargoRoot(root: string, lock: string): Promise<{ dir: string; lock: string }> {
  const dir = path.join(root, "projects/apps/source-policy");
  await fsp.mkdir(path.join(dir, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "Cargo.toml"),
    '[package]\nname = "source-policy"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await fsp.writeFile(path.join(dir, "src/lib.rs"), "pub fn value() -> u8 { 1 }\n");
  const lockFile = path.join(dir, "Cargo.lock");
  await fsp.writeFile(lockFile, lock);
  return { dir, lock: lockFile };
}

async function fakeCargo(root: string, generatedSource: string): Promise<string> {
  const cargo = path.join(root, "fake-cargo");
  await fsp.writeFile(
    cargo,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const args = process.argv.slice(2);",
      'if (args[0] === "metadata" && !args.includes("--locked")) {',
      `  fs.writeFileSync(path.join(process.cwd(), "Cargo.lock"), ${JSON.stringify(
        `version = 3\n\n[[package]]\nname = "source-policy"\nversion = "0.1.0"\nsource = "${generatedSource}"\n`,
      )});`,
      "}",
      'process.stdout.write("{}\\n");',
    ].join("\n"),
    { mode: 0o755 },
  );
  return cargo;
}

test("read-only Cargo validation rejects alternate registries before tool execution", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-"));
  try {
    const initial =
      'version = 3\n\n[[package]]\nname = "source-policy"\nversion = "0.1.0"\nsource = "registry+file:///fixture/index"\n';
    const fixture = await cargoRoot(root, initial);
    await assert.rejects(
      assertRustTrackedMetadataReady(root, path.join(root, "must-not-run-cargo")),
      /unsupported dependency source: registry\+file:\/\/\/fixture\/index/,
    );
    assert.equal(await fsp.readFile(fixture.lock, "utf8"), initial);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("source policy rejects alternate registries across valid TOML assignment formatting", async () => {
  const assignments = [
    '  source = "registry+file:///indented/index"',
    'source="registry+file:///compact/index"',
    "source = 'registry+file:///literal/index'",
  ];
  for (const [index, assignment] of assignments.entries()) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-format-"));
    try {
      const initial = [
        "version = 3",
        "",
        "[[package]]",
        'name = "source-policy"',
        'version = "0.1.0"',
        assignment,
        "",
      ].join("\n");
      const fixture = await cargoRoot(root, initial);
      await assert.rejects(
        assertRustTrackedMetadataReady(root, path.join(root, "must-not-run-cargo")),
        /unsupported dependency source: registry\+file:/,
        `format variant ${index + 1} must fail before Cargo execution`,
      );
      await assert.rejects(
        execFileAsync(nixInstantiate, [
          "--eval",
          "--strict",
          "--expr",
          `import ${JSON.stringify(nixSourcePolicy)} { lockFile = builtins.toPath ${JSON.stringify(
            fixture.lock,
          )}; }`,
        ]),
        /unsupported dependency source: registry\+file:/,
        `Nix format variant ${index + 1} must fail during policy evaluation`,
      );
      assert.equal(await fsp.readFile(fixture.lock, "utf8"), initial);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
});

test("read-only validation rejects escaped quoted keys before Cargo execution", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-key-"));
  try {
    const initial = [
      "version = 3",
      "",
      "[[package]]",
      'name = "source-policy"',
      'version = "0.1.0"',
      '"sou\\u0072ce" = "registry+file:///escaped-key/index"',
      "",
    ].join("\n");
    const fixture = await cargoRoot(root, initial);
    await assert.rejects(
      assertRustTrackedMetadataReady(root, path.join(root, "must-not-run-cargo")),
      /unsupported quoted assignment key/,
    );
    assert.equal(await fsp.readFile(fixture.lock, "utf8"), initial);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("read-only validation accepts normal quoted entries in dependency arrays", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-array-"));
  try {
    const initial = [
      "version = 3",
      "",
      "[[package]]",
      'name = "source-policy"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "local-dep",',
      "]",
      "",
      "[[package]]",
      'name = "local-dep"',
      'version = "0.1.0"',
      "",
    ].join("\n");
    await cargoRoot(root, initial);
    const cargo = await fakeCargo(root, "registry+https://github.com/rust-lang/crates.io-index");
    await assertRustTrackedMetadataReady(root, cargo);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Cargo update rejects generated Git locks and preserves live bytes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-"));
  try {
    const initial = "version = 3\n";
    const fixture = await cargoRoot(root, initial);
    const cargo = await fakeCargo(root, "git+file:///fixture/repo#0123456789abcdef");
    await assert.rejects(
      repairRustDependencies(root, false, false, cargo),
      /unsupported dependency source: git\+file:\/\/\/fixture\/repo/,
    );
    assert.equal(await fsp.readFile(fixture.lock, "utf8"), initial);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("read-only validation rejects project Cargo config before tool execution", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-"));
  try {
    const fixture = await cargoRoot(root, "version = 3\n");
    await fsp.mkdir(path.join(fixture.dir, ".cargo"), { recursive: true });
    await fsp.writeFile(
      path.join(fixture.dir, ".cargo/config.toml"),
      '[source.crates-io]\nreplace-with = "alternate"\n',
    );
    await assert.rejects(
      assertRustTrackedMetadataReady(root, path.join(root, "must-not-run-cargo")),
      /Cargo configuration is unsupported.*\.cargo\/config\.toml/,
    );
    assert.equal(await fsp.readFile(fixture.lock, "utf8"), "version = 3\n");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Cargo repair rejects workspace cargo-home config without publishing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-"));
  const inheritedSharedCargoHome = process.env.VBR_SHARED_CARGO_HOME;
  try {
    const initial = "version = 3\n";
    const fixture = await cargoRoot(root, initial);
    const cargoHome = path.join(root, ".viberoots/cargo-home.noindex");
    await fsp.mkdir(cargoHome, { recursive: true });
    await fsp.writeFile(
      path.join(cargoHome, "config"),
      '[source.crates-io]\nreplace-with = "alternate"\n',
    );
    process.env.VBR_SHARED_CARGO_HOME = cargoHome;
    await assert.rejects(
      repairRustDependencies(root, false, false, path.join(root, "must-not-run-cargo")),
      /Cargo configuration is unsupported.*cargo-home\.noindex\/config/,
    );
    assert.equal(await fsp.readFile(fixture.lock, "utf8"), initial);
  } finally {
    if (inheritedSharedCargoHome === undefined) delete process.env.VBR_SHARED_CARGO_HOME;
    else process.env.VBR_SHARED_CARGO_HOME = inheritedSharedCargoHome;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Cargo config isolation rejects ancestors of the actual execution cwd", async () => {
  const ancestor = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-ancestor-"));
  try {
    const nestedCargoRoot = path.join(ancestor, "nested");
    await fsp.mkdir(nestedCargoRoot, { recursive: true });
    await fsp.mkdir(path.join(ancestor, ".cargo"), { recursive: true });
    await fsp.writeFile(path.join(ancestor, ".cargo/config.toml"), "[net]\noffline = false\n");
    await assert.rejects(
      assertCargoConfigIsolation(nestedCargoRoot, path.join(ancestor, "cargo-home")),
      /Cargo configuration is unsupported.*\.cargo\/config\.toml/,
    );
  } finally {
    await fsp.rm(ancestor, { recursive: true, force: true });
  }
});
