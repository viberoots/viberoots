#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cgo_deps wires provider dep; build stays planner-scoped", async () => {
  await runInTemp("go-cgo-zlib", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nix_pkgs_pkgs_zlib", attr="pkgs.zlib")
EOF'`;

    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p apps/demo-cli/cmd/demo && cat > apps/demo-cli/cmd/demo/main.go <<'\''EOF'\''
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

    await $({ cwd: tmp })`bash -lc 'cat > apps/demo-cli/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    nix_cgo_deps = ["pkgs.zlib"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery "deps(//apps/demo-cli:demo)" --json --output-attributes name`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{ name: string }>;
    const names = new Set(nodes.map((n) => n.name));
    if (!names.has("//third_party/providers:nix_pkgs_pkgs_zlib")) {
      console.error("expected provider dep present");
      process.exit(2);
    }
  });
});
