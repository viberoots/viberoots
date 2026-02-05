#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test fails fast when default lockfile is missing", async () => {
  await runInTemp("node-nix-test-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        "  patterns = [],",
        // Intentionally omit any lockfile label argument or stamped label
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/web:t`;

    assert.notEqual(res.exitCode, 0, "expected buck2 cquery to fail when lockfile is missing");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "nix_node_test: missing lockfile at projects/apps/web/pnpm-lock.yaml. Provide lockfile_label or create projects/apps/web/pnpm-lock.yaml.",
      ),
      "expected missing default lockfile error",
    );
  });
});
