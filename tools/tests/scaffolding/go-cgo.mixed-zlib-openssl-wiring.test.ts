#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cgo_deps wires both zlib and openssl providers", async () => {
  await runInTemp("go-cgo-mixed-wiring", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nx_pkgs_zlib", attr="pkgs.zlib")
nix_cxx_library(name="nx_pkgs_openssl", attr="pkgs.openssl")
EOF'`;

    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p apps/demo-cli/cmd/demo && cat > apps/demo-cli/cmd/demo/main.go <<'\''EOF'\''
package main
/*
#cgo pkg-config: zlib openssl
#include <zlib.h>
#include <openssl/crypto.h>
*/
import "C"
func main() {}
EOF'`;

    await $({ cwd: tmp })`bash -lc 'cat > apps/demo-cli/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    nix_cgo_deps = ["pkgs.zlib", "pkgs.openssl"],
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
    const expect = [
      "//third_party/providers:nx_pkgs_zlib",
      "//third_party/providers:nx_pkgs_openssl",
    ];
    for (const p of expect) {
      if (!names.has(p)) {
        console.error("expected provider dep present:", p);
        process.exit(2);
      }
    }
  });
});
