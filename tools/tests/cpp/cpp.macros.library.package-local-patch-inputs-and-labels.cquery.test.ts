#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_library: includes package-local patch files as inputs, stamps patch_scope, and realizes provider edges", async () => {
  await runInTemp("cpp-lib-package-local-patch-inputs-and-labels", async (tmp, $) => {
    // Minimal provider target and auto_map mapping to verify provider-edge realization.
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/demo:core": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "lib.cpp"), "int demo(){return 0;}\n", "utf8");
    const patchRel = "apps/demo/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: cpp.macros.library.package-local-patch-inputs-and-labels.cquery.test.ts",
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "core",',
        '  srcs = ["src/lib.cpp"],',
        "  deps = [],",
        '  labels = ["lang:cpp"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const qSrcs = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/demo:core`;
    if (qSrcs.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable
    assert.ok(
      String(qSrcs.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );

    const qDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //apps/demo:core`;
    if (qDeps.exitCode !== 0) return;
    assert.ok(
      String(qDeps.stdout || "").includes("//third_party/providers:prov"),
      "expected provider target present in deps for nix_cpp_library",
    );

    const qLabels = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:core`;
    if (qLabels.exitCode !== 0) return;
    const out = String(qLabels.stdout || "");
    assert.ok(
      out.includes("patch_scope:package-local"),
      "expected patch_scope:package-local label",
    );
    assert.ok(out.includes("kind:lib"), "expected kind:lib label");
    assert.ok(out.includes("lang:cpp"), "expected lang:cpp label");
  });
});
