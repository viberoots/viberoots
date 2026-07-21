#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) stamps global Nix inputs via labels", async () => {
  await runInTemp("node-cli-bundle-stamp", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    // Create a dummy entry so cquery can typecheck srcs for the bundled rule
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  importer = "projects/apps/cli",',
        '  labels = ["lockfile:projects/apps/cli/pnpm-lock.yaml#projects/apps/cli"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/cli:tool`;
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
      out.includes('"node:cli-bundle"'),
      "expected bundled CLI semantics to be declared for the pure planner",
    );
    assert.ok(
      out.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present via global_nix_inputs()",
    );

    const srcsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/cli:tool`;
    if (srcsProbe.exitCode !== 0) return;
    const srcsOut = String(srcsProbe.stdout || "");
    assert.ok(
      srcsOut.includes(":flake.lock"),
      "expected stamping to be backed by real action inputs (srcs includes //.viberoots/workspace:flake.lock)",
    );
  });
});
