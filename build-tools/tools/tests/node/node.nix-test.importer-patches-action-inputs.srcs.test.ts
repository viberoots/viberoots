#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_test includes importer-local node patches in srcs (action inputs)", async () => {
  await runInTemp("node-nix-test-importer-patches-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(dir, "tests"), { recursive: true });
    await fsp.mkdir(path.join(dir, "patches", "node"), { recursive: true });

    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "patches", "node", "leftpad@1.3.0.patch"),
      "# noop\n",
      "utf8",
    );
    await fsp.writeFile(path.join(dir, "tests", "a.test.ts"), "import 'node:test'\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        '  patterns = ["tests/**/*.test.ts"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/web:t`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");

    assert.ok(
      out.includes("leftpad@1.3.0.patch"),
      "expected importer-local node patch file to be present in srcs",
    );
  });
});
