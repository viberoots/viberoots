#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const viberootsRoot = path.resolve("viberoots");

async function readViberootsPackage(): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(path.join(viberootsRoot, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * Confirms that lint-staged (invoked from .husky/pre-commit) includes the
 * stale-names-lint command for every relevant staged-file glob.
 *
 * This is a contract test: it reads package.json, parses the lint-staged
 * configuration, and asserts the expected command and file globs are present
 * so that adding or removing a glob without updating enforcement becomes a
 * visible test failure.
 */
test("lint-staged config includes stale-names-lint for ts/tsx staged files", async () => {
  const pkg = await readViberootsPackage();
  const lintStaged = pkg["lint-staged"] as Record<string, string | string[]> | undefined;
  assert.ok(
    lintStaged != null && typeof lintStaged === "object",
    "package.json must have a lint-staged configuration",
  );

  // The glob covering TypeScript files must invoke stale-names-lint.
  const tsGlob = lintStaged["**/*.{ts,tsx}"];
  assert.ok(
    Array.isArray(tsGlob),
    "lint-staged must have an array of commands for **/*.{ts,tsx} files",
  );
  const tsCommands = tsGlob as string[];
  const staleNamesInTs = tsCommands.some((cmd) => cmd.includes("stale-names-lint"));
  assert.ok(
    staleNamesInTs,
    "lint-staged '**/*.{ts,tsx}' must invoke stale-names-lint so staged TypeScript files are checked for stale repo names, plan numbers, and migration labels",
  );
});

test("lint-staged config includes stale-names-lint for bzl/nix/md staged files", async () => {
  const pkg = await readViberootsPackage();
  const lintStaged = pkg["lint-staged"] as Record<string, string | string[]> | undefined;
  assert.ok(
    lintStaged != null && typeof lintStaged === "object",
    "package.json must have a lint-staged configuration",
  );

  // The glob covering Starlark, Nix, and Markdown files must also invoke stale-names-lint.
  const bzlGlob = lintStaged["**/*.{bzl,nix,md}"];
  assert.ok(
    Array.isArray(bzlGlob),
    "lint-staged must have an array of commands for **/*.{bzl,nix,md} files",
  );
  const bzlCommands = bzlGlob as string[];
  const staleNamesInBzl = bzlCommands.some((cmd) => cmd.includes("stale-names-lint"));
  assert.ok(
    staleNamesInBzl,
    "lint-staged '**/*.{bzl,nix,md}' must invoke stale-names-lint so staged Starlark, Nix, and Markdown files are checked for stale repo names, plan numbers, and migration labels",
  );
});

test("lint-staged config includes stale-names-lint for js/json/yaml staged files", async () => {
  const pkg = await readViberootsPackage();
  const lintStaged = pkg["lint-staged"] as Record<string, string | string[]> | undefined;
  assert.ok(lintStaged != null && typeof lintStaged === "object");

  const dataGlob = lintStaged["**/*.{js,mjs,cjs,json,yml,yaml}"];
  assert.ok(
    Array.isArray(dataGlob),
    "lint-staged must have an array of commands for **/*.{js,mjs,cjs,json,yml,yaml} files",
  );
  const dataCommands = dataGlob as string[];
  const staleNamesInData = dataCommands.some((cmd) => cmd.includes("stale-names-lint"));
  assert.ok(
    staleNamesInData,
    "lint-staged data/script files must invoke stale-names-lint so package.json and config files cannot introduce stale names or migration labels",
  );
});

test("lint-staged config includes stale-names-lint for extensionless TARGETS files", async () => {
  const pkg = await readViberootsPackage();
  const lintStaged = pkg["lint-staged"] as Record<string, string | string[]> | undefined;
  assert.ok(lintStaged != null && typeof lintStaged === "object");

  const targetCommands = lintStaged["**/TARGETS"];
  assert.ok(Array.isArray(targetCommands), "lint-staged must cover extensionless TARGETS files");
  assert.ok(
    (targetCommands as string[]).some((cmd) => cmd.includes("stale-names-lint")),
    "lint-staged TARGETS files must invoke stale-names-lint",
  );
});

test("pre-commit hook delegates to lint-staged", async () => {
  const preCommit = await fsp.readFile(path.join(viberootsRoot, ".husky", "pre-commit"), "utf8");
  assert.ok(
    preCommit.includes("lint-staged"),
    ".husky/pre-commit must delegate to lint-staged so staged-file enforcement runs before every commit",
  );
  assert.ok(
    preCommit.includes("--relative"),
    ".husky/pre-commit must pass --relative to lint-staged so file paths are reported relative to the repository root",
  );
  assert.ok(
    preCommit.includes("--allow-empty"),
    ".husky/pre-commit must pass --allow-empty to lint-staged so commits that touch only non-linted file types are not blocked",
  );
});
