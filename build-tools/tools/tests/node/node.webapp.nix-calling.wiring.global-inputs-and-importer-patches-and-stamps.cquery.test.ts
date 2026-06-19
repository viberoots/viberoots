#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp (Nix-calling) wires global inputs + importer patches as action inputs and stamps viberoots/build-tools/lang/kind/patch_scope (cquery)", async () => {
  await runInTemp("node-webapp-nix-calling-wiring-cquery", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    const patchRel = "projects/apps/web/patches/node/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/web:bundle`;
    if (srcsProbe.exitCode !== 0) return;
    const srcsOut = String(srcsProbe.stdout || "");
    const altPatch = "patches/node/leftpad@1.3.0.patch";
    assert.ok(
      srcsOut.includes(patchRel) || srcsOut.includes(altPatch),
      `expected importer-local patch path present in srcs: ${patchRel} (or ${altPatch})`,
    );
    assert.ok(
      srcsOut.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present in srcs via global_nix_inputs()",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:bundle`;
    if (labelsProbe.exitCode !== 0) return;
    const labelsOut = String(labelsProbe.stdout || "");
    assert.ok(
      labelsOut.includes('"lang:node"') || labelsOut.includes(': "lang:node"'),
      "expected lang:node stamp",
    );
    assert.ok(
      labelsOut.includes('"kind:app"') || labelsOut.includes(': "kind:app"'),
      "expected kind:app stamp",
    );
    assert.ok(
      labelsOut.includes('"patch_scope:importer-local"') ||
        labelsOut.includes(': "patch_scope:importer-local"'),
      "expected patch_scope:importer-local stamp",
    );
  });
});
