#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test requires exactly one importer-scoped lockfile label (shared error text)", async () => {
  await runInTemp("node-nix-test-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_test")',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/web:t`;

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 cquery to fail when lockfile label is missing",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>)",
      ),
      "expected shared error message for missing importer-scoped lockfile label",
    );
  });
});
