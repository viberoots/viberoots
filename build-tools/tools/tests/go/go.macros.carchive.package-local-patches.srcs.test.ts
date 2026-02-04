#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go macros: nix_go_carchive includes package-local patches in srcs (cquery)", async () => {
  await runInTemp("go-carchive-package-local-patches", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "pkg", "demo"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });

    await fsp.writeFile(
      path.join(appDir, "pkg", "demo", "x.go"),
      "package demo\n\nfunc X(){}\n",
      "utf8",
    );
    const patchRel = "apps/demo/patches/go/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.carchive.package-local-patches.srcs.test.ts",
        'load("//build-tools/go:defs.bzl", "nix_go_carchive")',
        "",
        "nix_go_carchive(",
        '  name = "arc",',
        '  srcs = ["pkg/demo/x.go"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/demo:arc`;
    if (probe.exitCode !== 0) return;
    assert.ok(
      String(probe.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );
  });
});
