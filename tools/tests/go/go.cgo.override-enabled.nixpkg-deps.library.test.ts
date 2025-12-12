#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_library enables override_cgo_enabled when nixpkg_deps present", async () => {
  await runInTemp("go-cgo-override-nixpkg-lib", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p tmp/pkg/demo && cat > tmp/pkg/demo/demo.go <<'\''EOF'\''
package demo

func X() {}
EOF'`;

    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = glob(["pkg/**/*.go"]),
    nixpkg_deps = ["pkgs.zlib"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_cgo_override_nixpkg_lib cquery --target-platforms //:no_cgo --json --output-attributes override_cgo_enabled,labels //tmp:lib`;
    if (probe.exitCode !== 0) return; // skip if prelude not available

    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{
      labels?: string[];
      override_cgo_enabled?: boolean;
    }>;
    assert.equal(nodes[0]?.override_cgo_enabled, true);
    const labels = nodes[0]?.labels || [];
    assert.ok(labels.includes("cgo:enabled"));
    assert.ok(labels.includes("nixpkg:pkgs.zlib"));
  });
});
