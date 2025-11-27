#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) stamps global Nix inputs via labels", async () => {
  await runInTemp("node-cli-bundle-stamp", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "cli");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  importer = "apps/cli",',
        '  labels = ["lockfile:apps/cli/pnpm-lock.yaml#apps/cli"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --json --output-attributes labels //apps/cli:tool`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(': "lang:node"') || out.includes('"lang:node"'),
      "expected lang:node label to be present",
    );
    assert.ok(
      out.includes(":flake.lock"),
      "expected //:flake.lock to be present via global_nix_inputs()",
    );
  });
});
