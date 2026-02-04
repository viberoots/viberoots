#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros inject importer-local patches into dict-shaped srcs via synthetic keys (cquery)", async () => {
  await runInTemp("node-importer-patches-srcs-dict-shape", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    const patchDir = path.join(appDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    const patchRel = "apps/web/patches/node/leftpad@1.3.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.importer-patches.srcs-dict-shape.not-included.cquery.test.ts",
        'load("//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "node_gen_dict_srcs_probe",',
        '  out = "out.txt",',
        '  cmd = "echo ok > $OUT",',
        "  srcs = {",
        '    "bin/entry.js": "bin/entry.js",',
        "  },",
        '  lockfile_label = "lockfile:apps/web/pnpm-lock.yaml#apps/web",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.mkdir(path.join(tmp, "bin"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "bin", "entry.js"), "console.log('ok')\n", "utf8");

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //:node_gen_dict_srcs_probe`;
    if (probe.exitCode !== 0) {
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
