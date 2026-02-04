#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python importer-scoped macros fail fast when labels and lockfile_label disagree", async () => {
  await runInTemp("python-lockfile-label-disagreement", async (tmp, $) => {
    const aDir = path.join(tmp, "apps", "a");
    const bDir = path.join(tmp, "apps", "b");
    await fsp.mkdir(aDir, { recursive: true });
    await fsp.mkdir(bDir, { recursive: true });
    await fsp.writeFile(path.join(aDir, "uv.lock"), "# lock\n", "utf8");
    await fsp.writeFile(path.join(bDir, "uv.lock"), "# lock\n", "utf8");

    await fsp.writeFile(
      path.join(aDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_library")',
        "",
        "nix_python_library(",
        '  name = "lib",',
        '  labels = ["lockfile:apps/a/uv.lock#apps/a"],',
        '  lockfile_label = "lockfile:apps/b/uv.lock#apps/b",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/a:lib`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail on lockfile label disagreement");
    const combined = String(q.stderr || "") + String(q.stdout || "");
    assert.ok(
      combined.includes("Exactly one importer-scoped lockfile label is required"),
      `expected deterministic single-lockfile-label guidance, got:\n${combined}`,
    );
  });
});
