#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";

test("filter-repo excludes generated app output directories from flake snapshots", async () => {
  const file = await fs.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/filter-repo.nix",
    "utf8",
  );
  for (const dir of ["dist", "build", ".vite", ".next", ".wasm-producer"]) {
    assert.match(
      file,
      new RegExp(`isGeneratedTree "${dir.replace(/\./g, "\\.")}"`),
      `expected filter-repo to exclude ${dir}`,
    );
  }
  for (const dir of [
    ".codex-logs",
    "backups",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "pr-logs",
    "viberoots",
    "viberoots-flake-input",
    "xdg-cache",
  ]) {
    assert.match(
      file,
      new RegExp(`isRootDir "${dir.replace(/\./g, "\\.")}"`),
      `expected filter-repo to exclude root ${dir}`,
    );
  }
  for (const dir of ["buck", "cache", "codex-logs", "codex-test-logs"]) {
    assert.match(
      file,
      new RegExp(`isHiddenViberootsGeneratedRoot "${dir}"`),
      `expected filter-repo to exclude root .viberoots/${dir}`,
    );
  }
  for (const dir of [
    ".viberoots",
    "backups",
    "buck",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "node",
    "pr-logs",
    "viberoots-flake-input",
    "xdg-cache",
  ]) {
    assert.match(
      file,
      new RegExp(`isWorkspaceGeneratedRoot "${dir.replace(/\./g, "\\.")}"`),
      `expected filter-repo to exclude root .viberoots/workspace/${dir}`,
    );
  }
  for (const dir of [
    ".codex-logs",
    ".viberoots",
    "backups",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "pr-logs",
    "test-logs",
    "xdg-cache",
  ]) {
    assert.match(
      file,
      new RegExp(`isViberootsGeneratedRoot "${dir.replace(/\./g, "\\.")}"`),
      `expected filter-repo to exclude nested viberoots/${dir}`,
    );
  }
  for (const token of [
    'isRootFile ".full-test-output.log"',
    'isRootFile ".patch-sessions.json"',
    "isRootCodexLog",
    'isViberootsGeneratedFile ".full-test-output.log"',
    'isViberootsGeneratedFile ".patch-sessions.json"',
    "isViberootsCodexLog",
  ]) {
    assert.match(
      file,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `expected filter-repo to exclude generated log file via ${token}`,
    );
  }
  for (const token of [
    "isProjectRootGeneratedEntry",
    "generatedProjectRootNames",
    "generatedProjectRootFiles",
    '".codex-logs"',
    '".full-test-output.log"',
    '".patch-sessions.json"',
  ]) {
    assert.match(
      file,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `expected filter-repo to exclude project-root generated entries via ${token}`,
    );
  }
  assert.match(
    file,
    /\(_type == "directory" \|\| _type == "symlink"\)/,
    "generated output filtering must exclude symlinked generated trees",
  );
  assert.doesNotMatch(
    file,
    /_type == "regular"/,
    "generated output filtering must not exclude executable files named build/dist",
  );
});
