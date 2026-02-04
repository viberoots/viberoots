#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros fail fast when importer-local patches would cross a Buck package boundary (subpackage call site)", async () => {
  await runInTemp("node-importer-patches-subpackage-callsite-fails-fast", async (tmp, $) => {
    const importerDir = path.join(tmp, "apps", "demo");
    const subpkgDir = path.join(importerDir, "subpkg");
    const patchDir = path.join(importerDir, "patches", "node");

    await fsp.mkdir(path.join(importerDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.mkdir(path.join(subpkgDir, "src"), { recursive: true });

    await fsp.writeFile(path.join(importerDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(importerDir, "src", "index.ts"), "console.log('root')\n", "utf8");
    await fsp.writeFile(path.join(subpkgDir, "src", "index.ts"), "console.log('subpkg')\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "leftpad@1.3.0.patch"), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(subpkgDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  lockfile_label = "lockfile:apps/demo/pnpm-lock.yaml#apps/demo",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/demo/subpkg:bundle`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail for subpackage callsite");
    const combined = String(q.stderr || "") + String(q.stdout || "");
    assert.ok(
      combined.includes("Importer-local patches must be wired from the importer package"),
      `expected deterministic package-boundary guidance, got:\n${combined}`,
    );
  });
});
