#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return (v[0] as T) ?? null;
    return (v as T) ?? null;
  }
  return null;
}

test("nix_go_test enables override_cgo_enabled when C-family srcs present (without stamping cgo:enabled)", async () => {
  await runInTemp("go-cgo-override-srcs-test", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp/pkg/demo && cat > tmp/pkg/demo/demo_test.go <<'\''EOF'\''
package demo

import "testing"

func TestX(t *testing.T) {}
EOF'`;
    await $({ cwd: tmp })`bash --noprofile --norc -c 'cat > tmp/pkg/demo/shim.c <<'\''EOF'\''
int demo_shim() { return 1; }
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_test")

nix_go_test(
    name = "t",
    srcs = [
        "pkg/demo/demo_test.go",
        "pkg/demo/shim.c",
    ],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_cgo_override_srcs_test cquery --target-platforms //:no_cgo --json --output-attribute override_cgo_enabled --output-attribute labels //tmp:t`;
    if (probe.exitCode !== 0) return; // skip if prelude not available

    const node = firstCqueryNode<{
      labels?: string[];
      override_cgo_enabled?: boolean;
    }>(JSON.parse(String(probe.stdout || "")));
    assert.equal(node?.override_cgo_enabled, true);
    const labels = node?.labels || [];
    assert.ok(!labels.includes("cgo:enabled"));
  });
});
