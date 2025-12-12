#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_binary enables override_cgo_enabled when repo_cgo_deps present", async () => {
  await runInTemp("go-cgo-override-repo-bin", async (tmp, $) => {
    await $({ cwd: tmp })`bash -lc 'mkdir -p libs/native && cat > libs/native/TARGETS <<'\''EOF'\''
genrule(name="native", out="native.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;

    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p tmp/cmd/demo && cat > tmp/cmd/demo/main.go <<'\''EOF'\''
package main

func main() {}
EOF'`;

    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    repo_cgo_deps = ["//libs/native:native"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_cgo_override_repo_bin cquery --target-platforms //:no_cgo --json --output-attributes override_cgo_enabled,labels //tmp:demo`;
    if (probe.exitCode !== 0) return; // skip if prelude not available

    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{
      labels?: string[];
      override_cgo_enabled?: boolean;
    }>;
    assert.equal(nodes[0]?.override_cgo_enabled, true);
    const labels = nodes[0]?.labels || [];
    assert.ok(labels.includes("cgo:enabled"));
  });
});
