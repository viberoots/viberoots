#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

async function cqueryKind(
  $: any,
  tmp: string,
  isolationDir: string,
  expression: string,
): Promise<{ exitCode: number; stdout: string }> {
  const probe = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms //:no_cgo ${expression}`;
  return {
    exitCode: Number(probe.exitCode ?? 1),
    stdout: String(probe.stdout || ""),
  };
}

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

    const libProbe = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_nix_build, //tmp/pkg:lib)",
    );
    if (libProbe.exitCode !== 0) return;
    assert.ok(libProbe.stdout.includes("//tmp/pkg:lib"));

    const binProbe = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_nix_build, //tmp/pkg:app)",
    );
    assert.ok(binProbe.stdout.includes("//tmp/pkg:app"));

    const testProbe = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_nix_test, //tmp/pkg:lib_test)",
    );
    assert.ok(testProbe.stdout.includes("//tmp/pkg:lib_test"));

    const libBuck = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_library, //tmp/pkg:lib)",
    );
    assert.equal(libBuck.stdout.trim(), "");

    const binBuck = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_binary, //tmp/pkg:app)",
    );
    assert.equal(binBuck.stdout.trim(), "");

    const testBuck = await cqueryKind(
      $,
      tmp,
      "go_nix_build_rule_types",
      "kind(go_test, //tmp/pkg:lib_test)",
    );
    assert.equal(testBuck.stdout.trim(), "");
  });
});

test("go route detector: Buck go_* control target is caught by negative-route query", async () => {
  await runInTemp("go-buck-rule-route-control", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp/control/pkg && cat > tmp/control/pkg/lib.go <<'\''EOF'\''
package pkg

func X() {}
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/control/pkg/lib_test.go <<'\''EOF'\''
package pkg

import "testing"

func TestX(t *testing.T) {}
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/control/pkg/main.go <<'\''EOF'\''
package main

func main() {}
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > tmp/control/TARGETS <<'\''EOF'\''
go_library(
    name = "legacy_lib",
    srcs = ["pkg/lib.go"],
)

go_binary(
    name = "legacy_bin",
    srcs = ["pkg/main.go"],
)

go_test(
    name = "legacy_test",
    srcs = ["pkg/lib_test.go"],
)
EOF'`;

    const libProbe = await cqueryKind(
      $,
      tmp,
      "go_buck_rule_route_control",
      "kind(go_library, //tmp/control:legacy_lib)",
    );
    if (libProbe.exitCode !== 0) return;
    assert.ok(libProbe.stdout.includes("//tmp/control:legacy_lib"));

    const binProbe = await cqueryKind(
      $,
      tmp,
      "go_buck_rule_route_control",
      "kind(go_binary, //tmp/control:legacy_bin)",
    );
    assert.ok(binProbe.stdout.includes("//tmp/control:legacy_bin"));

    const testProbe = await cqueryKind(
      $,
      tmp,
      "go_buck_rule_route_control",
      "kind(go_test, //tmp/control:legacy_test)",
    );
    assert.ok(testProbe.stdout.includes("//tmp/control:legacy_test"));
  });
});
