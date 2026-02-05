#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) fails fast when importer argument disagrees with lockfile_label importer", async () => {
  await runInTemp("node-cli-importer-arg-mismatch", async (tmp, $) => {
    const importerDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(importerDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(importerDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(importerDir, "src", "index.ts"), "console.log('ok')\n", "utf8");

    await fsp.writeFile(
      path.join(importerDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "cli",',
        "  bundle = True,",
        '  lockfile_label = "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",',
        '  importer = "projects/apps/other",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/demo:cli`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail on importer mismatch");
    const combined = String(q.stderr || "") + String(q.stdout || "");
    assert.ok(
      combined.includes("nix_node_cli_bin(bundle=True): importer must match"),
      `expected deterministic importer mismatch guidance, got:\n${combined}`,
    );
  });
});
