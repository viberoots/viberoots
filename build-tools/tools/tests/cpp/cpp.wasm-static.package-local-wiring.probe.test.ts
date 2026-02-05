#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_wasm_static_lib: stamps wasm + patch_scope and includes package-local patch inputs", async () => {
  await runInTemp("cpp-wasm-static-package-local-wiring", async (tmp, $) => {
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
  "//projects/apps/demo:core_static": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    const patchRel = "projects/apps/demo/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# noop\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: cpp.wasm-static.package-local-wiring.probe.test.ts",
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
        "",
        "nix_cpp_wasm_static_lib(",
        '  name = "core_static",',
        '  srcs = ["src/main.cpp"],',
        "  deps = [],",
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/demo:core_static`;
    if (probeSrcs.exitCode !== 0) return;
    assert.ok(
      String(probeSrcs.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );

    const probeDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:core_static`;
    if (probeDeps.exitCode !== 0) return;
    assert.ok(
      String(probeDeps.stdout || "").includes("//third_party/providers:prov"),
      "expected provider target present in deps for nix_cpp_wasm_static_lib",
    );

    const probeLabels = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/demo:core_static`;
    if (probeLabels.exitCode !== 0) return;
    const out = String(probeLabels.stdout || "");
    assert.ok(out.includes("wasm:static"), "expected wasm:static label");
    assert.ok(out.includes("kind:wasm"), "expected kind:wasm label");
    assert.ok(
      out.includes("patch_scope:package-local"),
      "expected patch_scope:package-local label",
    );
  });
});
