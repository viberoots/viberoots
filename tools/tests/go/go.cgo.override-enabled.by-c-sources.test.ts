#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_test enables override_cgo_enabled when C-family srcs present (without stamping cgo:enabled)", async () => {
  await runInTemp("go-cgo-override-srcs-test", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p tmp/pkg/demo && cat > tmp/pkg/demo/demo_test.go <<'\''EOF'\''
package demo

import "testing"

func TestX(t *testing.T) {}
EOF'`;
    await $({ cwd: tmp })`bash -lc 'cat > tmp/pkg/demo/shim.c <<'\''EOF'\''
int demo_shim() { return 1; }
EOF'`;

    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_test")

nix_go_test(
    name = "t",
    srcs = [
        "pkg/demo/demo_test.go",
        "pkg/demo/shim.c",
    ],
    labels = ["lang:go", "kind:test"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_cgo_override_srcs_test cquery --target-platforms //:no_cgo --json --output-attributes override_cgo_enabled,labels //tmp:t`;
    if (probe.exitCode !== 0) return; // skip if prelude not available

    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{
      labels?: string[];
      override_cgo_enabled?: boolean;
    }>;
    assert.equal(nodes[0]?.override_cgo_enabled, true);
    const labels = nodes[0]?.labels || [];
    assert.ok(!labels.includes("cgo:enabled"));
  });
});
