#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test fails deterministically when lockfile label is malformed", async () => {
  await runInTemp("node-nix-test-lockfile-malformed", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        "  patterns = [],",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/web:t`;

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 cquery to fail when lockfile label is malformed",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes("missing '#<importer>'"),
      "expected deterministic error text for malformed lockfile label",
    );
  });
});
