#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  createUpdateCommandFixture as fixture,
  runUpdateCommand as run,
  snapshotUpdateCommandFixture as snapshot,
} from "./update-command-launcher.fixture";
import { removeTreeWithWritableFallback } from "../lib/test-helpers/remove-tree";

const execFileAsync = promisify(execFile);

async function addFixtureExportTarget(importer: string, source: string): Promise<void> {
  await fsp.writeFile(
    path.join(importer, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "export_file")',
      "",
      "export_file(",
      '    name = "fixture-source",',
      `    src = ${JSON.stringify(source)},`,
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
}

async function addOfflineSurfaces(root: string): Promise<void> {
  const importer = path.join(root, "projects/apps/mixed");
  const local = path.join(root, "projects/apps/local");
  await fsp.mkdir(importer, { recursive: true });
  await fsp.mkdir(local, { recursive: true });
  await fsp.writeFile(
    path.join(importer, "go.mod"),
    "module example.test/mixed\n\ngo 1.24\n\nrequire example.test/local v0.0.0\nreplace example.test/local => ../local\n",
  );
  await fsp.writeFile(
    path.join(importer, "main.go"),
    'package main\n\nimport _ "example.test/local"\n\nfunc main() {}\n',
  );
  await fsp.writeFile(path.join(local, "go.mod"), "module example.test/local\n\ngo 1.24\n");
  await fsp.writeFile(path.join(local, "local.go"), "package local\n");
  await fsp.writeFile(
    path.join(importer, "pyproject.toml"),
    "[project]\nname='mixed'\nversion='0.0.0'\nrequires-python='>=3.11'\n",
  );
  await fsp.writeFile(path.join(importer, "main.cpp"), "int main() { return 0; }\n");
  await fsp.mkdir(path.join(importer, "src"), { recursive: true });
  await fsp.mkdir(path.join(importer, "rust-local", "src"), { recursive: true });
  await fsp.writeFile(
    path.join(importer, "Cargo.toml"),
    '[package]\nname="mixed-rust"\nversion="0.1.0"\nedition="2021"\n\n[dependencies]\nrust-local={path="rust-local"}\n',
  );
  await fsp.writeFile(path.join(importer, "src", "lib.rs"), "pub fn mixed() -> u8 { 1 }\n");
  await fsp.writeFile(
    path.join(importer, "rust-local", "Cargo.toml"),
    '[package]\nname="rust-local"\nversion="0.1.0"\nedition="2021"\n',
  );
  await fsp.writeFile(
    path.join(importer, "rust-local", "src", "lib.rs"),
    "pub fn local() -> u8 { 1 }\n",
  );
  await fsp.writeFile(
    path.join(importer, "Cargo.lock"),
    'version = 3\n\n[[package]]\nname = "mixed-rust"\nversion = "0.1.0"\ndependencies = [\n "rust-local",\n]\n\n[[package]]\nname = "rust-local"\nversion = "0.1.0"\n',
  );
  await addFixtureExportTarget(importer, "main.cpp");
  await execFileAsync("git", ["add", "projects"], { cwd: root });
}

async function addOfflinePnpm(root: string, importer: string, version = 1): Promise<void> {
  const localName = `local-package-v${version}`;
  const localPackage = path.join(importer, localName);
  await fsp.mkdir(localPackage, { recursive: true });
  await fsp.writeFile(
    path.join(localPackage, "package.json"),
    `{"name":"local-package","version":"${version}.0.0"}\n`,
  );
  await fsp.writeFile(
    path.join(importer, "package.json"),
    `{"name":"mixed","private":true,"dependencies":{"local-package":"file:./${localName}"}}\n`,
  );
  await fsp.writeFile(
    path.join(importer, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
  );
  await addFixtureExportTarget(importer, "package.json");
}

test("real u repairs bounded offline language inputs without moving viberoots", async () => {
  const root = await fixture("plain");
  try {
    await addOfflineSurfaces(root);
    const before = await snapshot(root);
    const hostile = path.join(root, "hostile-bin");
    const hostileMarker = path.join(root, "host-cargo-used");
    await fsp.mkdir(hostile);
    await fsp.writeFile(
      path.join(hostile, "cargo"),
      `#!/bin/sh\ntouch ${JSON.stringify(hostileMarker)}\nexit 97\n`,
      { mode: 0o755 },
    );
    await run(root, [], {
      PATH: `${hostile}${path.delimiter}${process.env.PATH || ""}`,
      RUSTFLAGS: "--hostile",
      RUSTUP_HOME: path.join(root, "hostile-rustup"),
      CARGO_HOME: path.join(root, "hostile-cargo-home"),
    });
    assert.deepEqual(await snapshot(root), before);
    await assert.rejects(fsp.access(hostileMarker), /ENOENT/);
    await fsp.access(path.join(root, "projects/apps/mixed/go.sum"));
    await fsp.access(path.join(root, "projects/apps/mixed/gomod2nix.toml"));
    assert.match(
      await fsp.readFile(path.join(root, "projects/apps/mixed/gomod2nix.toml"), "utf8"),
      /^# viberoots-go-input-sha256: [a-f0-9]{64}$/m,
    );
    await fsp.access(path.join(root, "projects/apps/mixed/uv.lock"));
    const glueFingerprint = JSON.parse(
      await fsp.readFile(
        path.join(root, ".viberoots/workspace/buck/prebuild-fingerprint.json"),
        "utf8",
      ),
    ) as { outputs?: string[] };
    assert.ok(
      glueFingerprint.outputs?.includes(".viberoots/current/build-tools/lang/nix_attr_aliases.bzl"),
      "real u must record repaired C++ source-selection metadata in the glue fingerprint",
    );
  } finally {
    await removeTreeWithWritableFallback(root, $);
  }
});

test("real u --upgrade upgrades bounded offline languages and reconciles C++", async () => {
  const root = await fixture("language-upgrade");
  try {
    await addOfflineSurfaces(root);
    const localManifest = path.join(root, "projects/apps/mixed/rust-local/Cargo.toml");
    await fsp.writeFile(
      localManifest,
      '[package]\nname="rust-local"\nversion="0.2.0"\nedition="2021"\n',
    );
    const before = await snapshot(root);
    const result = await run(root, ["--upgrade"]);
    assert.deepEqual(await snapshot(root), before);
    assert.match(result.stdout, /Go: upgraded 2 module/);
    assert.match(result.stdout, /Python\/uv: upgraded 1 project/);
    assert.match(result.stdout, /C\+\+: reconciliation-only/);
    assert.match(result.stdout, /Rust\/Cargo: upgraded 1 Cargo root/);
    assert.match(
      await fsp.readFile(path.join(root, "projects/apps/mixed/Cargo.lock"), "utf8"),
      /name = "rust-local"\nversion = "0\.2\.0"/,
    );
    await fsp.access(path.join(root, "projects/apps/mixed/go.sum"));
    await fsp.access(path.join(root, "projects/apps/mixed/gomod2nix.toml"));
    await fsp.access(path.join(root, "projects/apps/mixed/uv.lock"));
    await fsp.access(path.join(root, "projects/apps/local/go.sum"));
    await fsp.access(path.join(root, "projects/apps/local/gomod2nix.toml"));
  } finally {
    await removeTreeWithWritableFallback(root, $);
  }
});

test("real u --upgrade upgrades a bounded offline pnpm importer without moving viberoots", async () => {
  const root = await fixture("pnpm-upgrade");
  try {
    const importer = path.join(root, "projects/apps/pnpm-only");
    await addOfflinePnpm(root, importer);
    await execFileAsync("git", ["add", "projects"], { cwd: root });
    const beforeInitialUpdate = await snapshot(root);
    await run(root);
    assert.deepEqual(await snapshot(root), beforeInitialUpdate);
    const lock = path.join(importer, "pnpm-lock.yaml");
    const versionOneLock = await fsp.readFile(lock, "utf8");
    assert.match(versionOneLock, /file:local-package-v1/);
    await addOfflinePnpm(root, importer, 2);
    const before = await snapshot(root);
    await run(root, ["--upgrade"]);
    assert.deepEqual(await snapshot(root), before);
    const versionTwoLock = await fsp.readFile(lock, "utf8");
    assert.notEqual(versionTwoLock, versionOneLock);
    assert.match(versionTwoLock, /file:local-package-v2/);
  } finally {
    await removeTreeWithWritableFallback(root, $);
  }
});

test("real u launcher rejects a conflicting explicit artifact-tool authority", async () => {
  const root = await fixture("tool-authority-conflict");
  try {
    const lock = JSON.parse(await fsp.readFile(path.join(root, "flake.lock"), "utf8"));
    const viberootsNode = lock.nodes[lock.nodes[lock.root].inputs.viberoots];
    const conflictingRoot = String(viberootsNode.locked.path || "");
    assert.match(conflictingRoot, /^\/nix\/store\/[a-z0-9]{32}-/);
    await assert.rejects(
      run(root, [], { VBR_ARTIFACT_TOOLS_ROOT: conflictingRoot }),
      /canonical artifact tool authority mismatch/,
    );
  } finally {
    await removeTreeWithWritableFallback(root, $);
  }
});
