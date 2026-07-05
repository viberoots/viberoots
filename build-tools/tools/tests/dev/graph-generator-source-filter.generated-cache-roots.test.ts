#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("graph-generator source filter excludes generated cache roots", async () => {
  const source = await fsp.readFile(
    path.join(process.cwd(), "viberoots", "build-tools", "tools", "nix", "graph-generator.nix"),
    "utf8",
  );
  for (const name of [
    ".codex-logs",
    "backups",
    "cache",
    "codex-test-logs",
    "install-cache",
    "nix-xdg-cache",
    "pr-logs",
    "viberoots-flake-input",
    "xdg-cache",
  ]) {
    assert.match(
      source,
      new RegExp(`p == rootP \\+ "/${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"`),
      `graph-generator source filter must exclude root ${name}`,
    );
    assert.doesNotMatch(
      source,
      new RegExp(`base == "${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"`),
      `graph-generator source filter must not exclude nested source dirs named ${name}`,
    );
  }
  assert.match(
    source,
    /builtins\.elemAt relParts 1\) \[ "apps" "libs" \]/,
    "graph-generator source filter must scope project generated roots to projects/apps and projects/libs",
  );
  assert.match(
    source,
    /builtins\.elemAt relParts 3\) generatedProjectRootNames/,
    "graph-generator source filter must exclude generated dirs only at the project root",
  );
  assert.match(
    source,
    /isGeneratedProjectRootFile/,
    "graph-generator source filter must exclude project-root generated log files",
  );
  assert.match(source, /\.full-test-output\.log/);
  assert.match(source, /\.patch-sessions\.json/);
  assert.match(source, /\.codex-/);
});
