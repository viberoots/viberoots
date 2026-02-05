#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros include importer-local patches in srcs (cquery)", async () => {
  await runInTemp("node-importer-patches-srcs", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    // Minimal lockfile and a patch under importer "projects/apps/web"
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    const patchRel = "projects/apps/web/patches/node/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    // Define a tiny gen target at repo root bound to the importer; macro should append importer-local patches to srcs
    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.importer-patches.srcs-inclusion.cquery.test.ts",
        'load("//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "node_gen_importer_srcs_probe",',
        '  out = "out.txt",',
        '  cmd = "echo ok > $OUT",',
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Probe Buck for srcs; JSON shape varies, so perform substring check
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:node_gen_importer_srcs_probe`;
    if (probe.exitCode !== 0) {
      // Skip when prelude or toolchains aren't available in the ephemeral temp repo.
      return;
    }
    const out = String(probe.stdout || "");
    const alt = "patches/node/leftpad@1.3.0.patch";
    assert.ok(
      out.includes(patchRel) || out.includes(alt),
      `expected importer-local patch path present in srcs: ${patchRel} (or ${alt})`,
    );
  });
});
