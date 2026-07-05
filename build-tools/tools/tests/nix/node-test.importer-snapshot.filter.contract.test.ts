#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-test importer snapshots exclude generated and cache directories", async () => {
  const file = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/node-test.nix",
    "utf8",
  );
  for (const dir of [
    "node_modules",
    "dist",
    "build",
    ".vite",
    ".next",
    ".turbo",
    ".cache",
    ".direnv",
    ".pnpm-store",
    ".pnpm-home",
    "coverage",
    "report",
    "buck-out",
    "pnpm-workspace.yaml",
    ".codex-logs",
    "backups",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "pr-logs",
    "result",
    "test-logs",
    "viberoots-flake-input",
    "xdg-cache",
  ]) {
    assert.match(
      file,
      new RegExp(`"${dir.replace(/\./g, "\\.")}"`),
      `expected node-test importer snapshot to exclude ${dir}`,
    );
  }
  assert.match(
    file,
    /atImporterRoot && builtins\.elem n importerGeneratedRootEntries/,
    "expected node-test test-file discovery to skip generated dirs only at importer root",
  );
  assert.match(
    file,
    /importerAbs \+ "\/result-"/,
    "expected node-test importer snapshot to exclude importer-root result-* symlinks",
  );
  assert.match(
    file,
    /generatedRootFile/,
    "expected node-test importer snapshot to exclude importer-root generated log files",
  );
  assert.match(file, /\.full-test-output\.log/);
  assert.match(file, /\.patch-sessions\.json/);
  assert.match(file, /\.codex-/);
  assert.match(
    file,
    /node_modules\\\\\.lockfile-guard/,
    "expected node-test importer snapshot to exclude lockfile guard artifacts",
  );
});
