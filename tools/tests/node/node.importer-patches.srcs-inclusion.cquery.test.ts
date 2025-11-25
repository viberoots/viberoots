#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros include importer-local patches in srcs (cquery)", async () => {
  await runInTemp("node-importer-patches-srcs", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });

    // Minimal lockfile for importer "apps/web"
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    const patchRel = "apps/web/patches/node/lodash@4.17.21.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    // Define a tiny gen target at repo root bound to the importer; from root package,
    // globbing "apps/web/patches/node/*.patch" resolves correctly.
    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.importer-patches.srcs-inclusion.cquery.test.ts",
        'load("//node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "node_gen_importer_srcs_probe",',
        '  out = "out.txt",',
        '  cmd = "echo ok > $OUT",',
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Probe Buck for srcs; JSON shape varies between versions, so use substring check
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:node_gen_importer_srcs_probe`;
    if (probe.exitCode !== 0) {
      console.error("buck2 cquery failed; ensure prelude is available in temp repo");
      console.error(String(probe.stderr || probe.stdout || ""));
      process.exit(2);
    }
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(patchRel),
      `expected importer-local patch path present in srcs: ${patchRel}`,
    );
  });
});
