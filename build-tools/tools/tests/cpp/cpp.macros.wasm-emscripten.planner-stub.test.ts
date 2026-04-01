#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_wasm_emscripten_lib: routes through cpp_nix_build with wasm labels", async () => {
  await runInTemp("cpp-wasm-emscripten-stub", async (tmp, $) => {
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
  "//projects/apps/demo:core_emscripten": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(path.join(appDir, "patches", "cpp"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "src", "main.cpp"),
      ['extern "C" int add(int a, int b) { return a + b; }', "int main(){return 0;}", ""].join(
        "\n",
      ),
      "utf8",
    );
    const patchRel = "projects/apps/demo/patches/cpp/demo@0.0.0.patch";
    await fsp.writeFile(
      path.join(tmp, patchRel),
      [
        "--- a/src/main.cpp",
        "+++ b/src/main.cpp",
        "@@ -1,2 +1,2 @@",
        ' extern "C" int add(int a, int b) { return a + b; }',
        "-int main(){return 0;}",
        "+int main() { return 0; }",
        "",
      ].join("\n"),
      "utf8",
    );

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: cpp.macros.wasm-emscripten.planner-stub.test.ts",
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_emscripten_lib")',
        "",
        "nix_cpp_wasm_emscripten_lib(",
        '  name = "core_emscripten",',
        "  deps = [],",
        '  labels = ["lang:cpp"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/demo:core_emscripten`;
    assert.equal(probeSrcs.exitCode, 0, String(probeSrcs.stderr || probeSrcs.stdout || ""));
    assert.ok(
      String(probeSrcs.stdout || "").includes(patchRel),
      `expected package-local patch path present in srcs: ${patchRel}`,
    );

    const probeDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:core_emscripten`;
    assert.equal(probeDeps.exitCode, 0, String(probeDeps.stderr || probeDeps.stdout || ""));
    assert.ok(
      String(probeDeps.stdout || "").includes("//third_party/providers:prov"),
      "expected provider target present in deps for nix_cpp_wasm_emscripten_lib",
    );

    const probeLabels = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/demo:core_emscripten`;
    assert.equal(probeLabels.exitCode, 0, String(probeLabels.stderr || probeLabels.stdout || ""));
    const out = String(probeLabels.stdout || "");
    assert.ok(out.includes("wasm:emscripten"), "expected wasm:emscripten label on target");
    assert.ok(out.includes("kind:wasm"), "expected kind:wasm label on target");
    assert.ok(out.includes("kind:lib"), "expected kind:lib label for cpp planner kind inference");
    assert.ok(
      out.includes("patch_scope:package-local"),
      "expected patch_scope:package-local label on target",
    );

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //projects/apps/demo:core_emscripten`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout || ""));
    assert.ok(
      String(build.stdout || "").includes("core_emscripten.stamp"),
      "expected nix_cpp_wasm_emscripten_lib to produce a stamp output",
    );
    const stampPath = String(build.stdout || "")
      .trim()
      .split(/\s+/)
      .at(-1);
    assert.ok(stampPath, "expected buck2 build --show-output to print the stamp path");
    const stampAbs = path.isAbsolute(String(stampPath))
      ? String(stampPath)
      : path.join(tmp, String(stampPath));
    const stampText = await fsp.readFile(stampAbs, "utf8");
    assert.ok(stampText.includes("build_log="), "expected emscripten stamp to expose build_log");
    assert.ok(stampText.includes("phase_log="), "expected emscripten stamp to expose phase_log");
    assert.ok(
      stampText.includes("selected_build_secs="),
      "expected emscripten stamp to expose selected build timing",
    );
  });
});
