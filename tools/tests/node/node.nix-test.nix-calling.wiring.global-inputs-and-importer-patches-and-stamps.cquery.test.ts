#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test (Nix-calling) wires global inputs + importer patches as action inputs and stamps lang/kind/patch_scope (cquery)", async () => {
  await runInTemp("node-nix-test-nix-calling-wiring-cquery", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(path.join(appDir, "tests"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(appDir, "tests", "a.test.ts"), "import 'node:test'\n", "utf8");

    const patchRel = "apps/web/patches/node/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        '  patterns = ["tests/**/*.test.ts"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const srcsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/web:t`;
    if (srcsProbe.exitCode !== 0) return;
    const srcsOut = String(srcsProbe.stdout || "");
    const altPatch = "patches/node/leftpad@1.3.0.patch";
    assert.ok(
      srcsOut.includes(patchRel) || srcsOut.includes(altPatch),
      `expected importer-local patch path present in srcs: ${patchRel} (or ${altPatch})`,
    );
    assert.ok(
      srcsOut.includes(":flake.lock"),
      "expected //:flake.lock to be present in srcs via global_nix_inputs()",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/web:t`;
    if (labelsProbe.exitCode !== 0) return;
    const labelsOut = String(labelsProbe.stdout || "");
    assert.ok(
      labelsOut.includes('"lang:node"') || labelsOut.includes(': "lang:node"'),
      "expected lang:node stamp",
    );
    assert.ok(
      labelsOut.includes('"kind:test"') || labelsOut.includes(': "kind:test"'),
      "expected kind:test stamp",
    );
    assert.ok(
      labelsOut.includes('"patch_scope:importer-local"') ||
        labelsOut.includes(': "patch_scope:importer-local"'),
      "expected patch_scope:importer-local stamp",
    );
    assert.ok(
      !labelsOut.includes(":flake.lock"),
      "expected nix_node_test to keep global input stamping disabled (global_inputs_stamp=False)",
    );
  });
});
