#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go macros: provider edges realized into srcs for nix_go_tiny_wasm_lib", async () => {
  await runInTemp("go-macro-providers-srcs-tinygo-wasm", async (tmp, $) => {
    // Minimal provider and auto_map mapping
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//projects/apps/wasm:mod": ["//third_party/providers:prov"],
}
EOF'`;

    const appDir = path.join(tmp, "projects", "apps", "wasm");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.macros.providers-realized.srcs.tinygo-wasm.test.ts",
        'load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '  name = "mod",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/wasm:mod`;
    if (probe.exitCode !== 0) return;
    assert.ok(
      String(probe.stdout || "").includes("//third_party/providers:prov"),
      "expected provider target present in srcs for nix_go_tiny_wasm_lib",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/wasm:mod`;
    if (labelsProbe.exitCode !== 0) return;
    assert.ok(
      String(labelsProbe.stdout || "").includes("patch_scope:package-local"),
      "expected patch_scope:package-local label on nix_go_tiny_wasm_lib",
    );
  });
});
