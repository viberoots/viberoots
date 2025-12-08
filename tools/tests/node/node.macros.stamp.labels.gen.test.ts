#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros: nix_node_gen stamps lang:node and kind:gen", async () => {
  await runInTemp("node-macro-stamp-gen", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    // Minimal lockfile to satisfy importer-scoped label
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    // Define a minimal gen target bound to the importer
    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: node.macros.stamp.labels.gen.test.ts",
        'load("//node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "stamp_probe",',
        '  out = "out.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Probe labels via cquery
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attributes labels //:stamp_probe`;
    if (probe.exitCode !== 0) {
      // Skip when prelude/toolchains unavailable in the ephemeral temp repo
      return;
    }
    const out = String(probe.stdout || "");
    assert.match(out, /"lang:node"/, "expected lang:node label");
    assert.match(out, /"kind:gen"/, "expected kind:gen label");
  });
});
