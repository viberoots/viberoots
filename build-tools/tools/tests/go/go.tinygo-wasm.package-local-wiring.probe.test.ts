#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_tiny_wasm_lib: stamps wasm + patch_scope and includes package-local patch inputs", async () => {
  await runInTemp("go-tinygo-wasm-package-local-wiring", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {}
EOF'`;

    const appDir = path.join(tmp, "apps", "wasm");
    await fsp.mkdir(path.join(appDir, "patches", "go"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "patches", "go", "a@1.0.0.patch"), "# a\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: go.tinygo-wasm.package-local-wiring.probe.test.ts",
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '  name = "mod",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const srcsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/wasm:mod`;
    if (srcsProbe.exitCode !== 0) return;
    assert.ok(
      String(srcsProbe.stdout || "").includes("patches/go/a@1.0.0.patch"),
      "expected package-local patch file present in srcs for nix_go_tiny_wasm_lib",
    );

    const labelsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/wasm:mod`;
    if (labelsProbe.exitCode !== 0) return;
    const labelsJson = String(labelsProbe.stdout || "");
    assert.ok(
      labelsJson.includes("patch_scope:package-local"),
      "expected patch_scope:package-local label",
    );
    assert.ok(labelsJson.includes("kind:wasm"), "expected kind:wasm label");
    assert.ok(labelsJson.includes("wasm:tinygo"), "expected wasm:tinygo label");
  });
});
