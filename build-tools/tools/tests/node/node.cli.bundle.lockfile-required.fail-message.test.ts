#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) defaults lockfile label and fails fast when missing", async () => {
  await runInTemp("node-cli-bundle-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('hello')\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
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
    })`buck2 build //projects/apps/cli:tool`;

    // Expect failure with targeted missing lockfile error from defaulting path
    assert.notEqual(res.exitCode, 0, "expected buck2 build to fail when lockfile label is missing");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "nix_node_cli_bin(bundle=True): missing lockfile at projects/apps/cli/pnpm-lock.yaml. Provide lockfile_label or create projects/apps/cli/pnpm-lock.yaml.",
      ),
      "expected targeted missing lockfile error",
    );
  });
});
