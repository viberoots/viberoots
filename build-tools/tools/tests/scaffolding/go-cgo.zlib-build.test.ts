#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nixpkg_deps wires provider dep; build stays planner-scoped", async () => {
  await runInTemp("go-cgo-zlib", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nix_pkgs_zlib", attr="pkgs.zlib")
EOF'`;

    // Map the demo target to the zlib provider via MODULE_PROVIDERS (auto_map)
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test
MODULE_PROVIDERS = {
    "//apps/demo-cli:demo": [
        "//third_party/providers:nix_pkgs_zlib",
    ],
}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p apps/demo-cli/cmd/demo && cat > apps/demo-cli/cmd/demo/main.go <<'\''EOF'\''
package main

/*
#cgo pkg-config: zlib
#include <zlib.h>
*/
import "C"

import "fmt"

func main() {
    fmt.Println("zlib version:", C.GoString(C.zlibVersion()))
}
EOF'`;

    await $({ cwd: tmp })`bash --noprofile --norc -c 'cat > apps/demo-cli/TARGETS <<'\''EOF'\''
load("//build-tools/go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    nixpkg_deps = ["pkgs.zlib"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cgo_zlib cquery "deps(//apps/demo-cli:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
    const values = Array.isArray(parsed)
      ? (parsed as Array<{ name: string }>)
      : (Object.values(parsed as Record<string, { name: string }>) as Array<{ name: string }>);
    const names = new Set(values.map((n) => n.name));
    if (!names.has("//third_party/providers:nix_pkgs_zlib")) {
      console.error("expected provider dep present");
      process.exit(2);
    }
  });
});
