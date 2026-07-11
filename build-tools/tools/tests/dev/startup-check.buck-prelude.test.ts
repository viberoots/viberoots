#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInTemp } from "../lib/test-helpers";

const startupCheckScript = fileURLToPath(new URL("../../dev/startup-check.ts", import.meta.url));

await runInTemp("startup-check-buck-prelude", async (tmp, $) => {
  // Case 1: Missing .buckconfig → should fail
  await fs.remove(path.join(tmp, ".buckconfig")).catch(() => {});
  let failed = false;
  try {
    await $({ cwd: tmp })`zx-wrapper ${startupCheckScript}`;
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("startup-check should fail when .buckconfig is missing");

  // Case 2: Present .buckconfig but missing prelude mapping → should fail
  await fs.writeFile(
    path.join(tmp, ".buckconfig"),
    [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "",
      "[cells]",
      "root = .",
      "",
    ].join("\n"),
    "utf8",
  );
  failed = false;
  try {
    await $({ cwd: tmp })`zx-wrapper ${startupCheckScript}`;
  } catch {
    failed = true;
  }
  if (!failed)
    throw new Error(
      "startup-check should fail when .buckconfig lacks prelude mapping in repositories/cells",
    );

  // Case 3: Valid mapping but missing prelude entrypoint -> should fail clearly
  await fs.writeFile(
    path.join(tmp, ".buckconfig"),
    [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "prelude = ./prelude",
      "config = ./prelude",
      "",
      "[cells]",
      "root = .",
      "prelude = ./prelude",
      "config = ./prelude",
      "",
      "[build]",
      "prelude = prelude",
      "user_platform = prelude//platforms:default",
      "target_platforms = prelude//platforms:default",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputFile(path.join(tmp, ".viberoots/workspace/flake.nix"), "{ outputs = _: {}; }\n");
  await fs.remove(path.join(tmp, ".viberoots/current"));
  await fs.remove(path.join(tmp, ".viberoots/workspace/prelude"));
  await fs.remove(path.join(tmp, "prelude"));
  failed = false;
  try {
    await $({ cwd: tmp })`zx-wrapper ${startupCheckScript}`;
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("startup-check should fail when prelude/prelude.bzl is missing");

  await fs.outputFile(path.join(tmp, "prelude/prelude.bzl"), "# legacy prelude\n", "utf8");
  await fs.remove(path.join(tmp, ".viberoots/workspace/prelude"));
  failed = false;
  try {
    await $({ cwd: tmp })`zx-wrapper ${startupCheckScript}`;
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("startup-check should ignore legacy root prelude/prelude.bzl");
  }
});
