#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner_stub_with_package_local_patches: includes patch files in srcs (cquery)", async () => {
  await runInTemp("planner-stub-with-package-local-patches", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "probe");
    await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });

    const patchRel = "projects/apps/probe/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: planner-stub.with-package-local-patches.probe.test.ts",
        'load("//build-tools/lang:planner_stub.bzl", "planner_stub_with_package_local_patches")',
        "",
        "planner_stub_with_package_local_patches(",
        '  name = "stub",',
        '  lang = "cpp",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/probe:stub`;
    if (probe.exitCode !== 0) return;
    assert.ok(
      String(probe.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );
  });
});
