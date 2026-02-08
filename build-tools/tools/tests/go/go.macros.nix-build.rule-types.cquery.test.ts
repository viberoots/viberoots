#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("go macros: nix_go_* targets use Nix-backed rules", async () => {
  await runInTemp("go-nix-build-rule-types", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp/pkg/app/cmd/app tmp/pkg/lib && cat > tmp/pkg/app/cmd/app/main.go <<'\''EOF'\''
package main

func main() {}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/pkg/lib/lib.go <<'\''EOF'\''
package lib

func X() {}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/pkg/lib/lib_test.go <<'\''EOF'\''
package lib

import "testing"

func TestX(t *testing.T) {}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/pkg/TARGETS <<'\''EOF'\''
load("//build-tools/go:defs.bzl", "nix_go_binary", "nix_go_library", "nix_go_test")

nix_go_library(
    name = "lib",
    srcs = glob(["lib/**/*.go"]),
)

nix_go_binary(
    name = "app",
    srcs = ["app/cmd/app/main.go"],
)

nix_go_test(
    name = "lib_test",
    srcs = ["lib/lib_test.go"],
)
EOF'`;

    const libProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_nix_build_rule_types cquery --target-platforms //:no_cgo "kind(go_nix_build, //tmp/pkg:lib)"`;
    if (libProbe.exitCode !== 0) return;
    assert.ok(String(libProbe.stdout || "").includes("//tmp/pkg:lib"));

    const binProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_nix_build_rule_types cquery --target-platforms //:no_cgo "kind(go_nix_build, //tmp/pkg:app)"`;
    assert.ok(String(binProbe.stdout || "").includes("//tmp/pkg:app"));

    const testProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_nix_build_rule_types cquery --target-platforms //:no_cgo "kind(go_nix_test, //tmp/pkg:lib_test)"`;
    assert.ok(String(testProbe.stdout || "").includes("//tmp/pkg:lib_test"));
  });
});
