#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_headers routes through cpp_nix_build and keeps package-local wiring", async () => {
  await runInTemp("cpp-headers-nix-route", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/libs/demo:demo_headers": ["//third_party/providers:prov"],
}
EOF'`;

    const libDir = path.join(tmp, "projects", "libs", "demo");
    await fsp.mkdir(path.join(libDir, "include"), { recursive: true });
    await fsp.mkdir(path.join(libDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(libDir, "include", "demo.h"), "#pragma once\n", "utf8");
    const patchRel = "projects/libs/demo/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(
      path.join(tmp, patchRel),
      [
        "--- a/include/demo.h",
        "+++ b/include/demo.h",
        "@@ -1 +1,2 @@",
        " #pragma once",
        "+",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_headers")',
        "",
        "nix_cpp_headers(",
        '  name = "demo_headers",',
        '  srcs = ["include/demo.h"],',
        '  labels = ["lang:cpp"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeSrcs = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/libs/demo:demo_headers`;
    assert.equal(probeSrcs.exitCode, 0, String(probeSrcs.stderr || probeSrcs.stdout || ""));
    assert.ok(String(probeSrcs.stdout || "").includes(patchRel));

    const probeDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/libs/demo:demo_headers`;
    assert.equal(probeDeps.exitCode, 0, String(probeDeps.stderr || probeDeps.stdout || ""));
    assert.ok(String(probeDeps.stdout || "").includes("//third_party/providers:prov"));

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //projects/libs/demo:demo_headers`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout || ""));
    assert.ok(String(build.stdout || "").includes("demo_headers.stamp"));
  });
});
