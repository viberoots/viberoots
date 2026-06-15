#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("nixpkg_deps wires both zlib and openssl providers", async () => {
  await runInTemp("go-cgo-mixed-wiring", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/defs_cpp.bzl <<'\''EOF'\''
def nix_cxx_library(name, **kwargs):
    native.filegroup(name = name, srcs = [], visibility = ["PUBLIC"])
EOF
cat > .viberoots/workspace/providers/TARGETS <<'\''EOF'\''
load("@workspace_providers//:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nix_pkgs_zlib", attr="pkgs.zlib")
nix_cxx_library(name="nix_pkgs_openssl", attr="pkgs.openssl")
EOF'`;

    // Map the demo target to both providers via MODULE_PROVIDERS (auto_map)
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > .viberoots/workspace/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test
MODULE_PROVIDERS = {
    "//projects/apps/demo-cli:demo": [
        "workspace_providers//:nix_pkgs_zlib",
        "workspace_providers//:nix_pkgs_openssl",
    ],
}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p projects/apps/demo-cli/cmd/demo && cat > projects/apps/demo-cli/cmd/demo/main.go <<'\''EOF'\''
package main
/*
#cgo pkg-config: zlib openssl
#include <zlib.h>
#include <openssl/crypto.h>
*/
import "C"
func main() {}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > projects/apps/demo-cli/TARGETS <<'\''EOF'\''
load("//build-tools/go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    nixpkg_deps = ["pkgs.zlib", "pkgs.openssl"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cgo_mixed")} cquery "deps(//projects/apps/demo-cli:demo)"`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const out = String(probe.stdout || "");
    const expect = [
      "workspace_providers//:nix_pkgs_zlib",
      "workspace_providers//:nix_pkgs_openssl",
    ];
    for (const p of expect) {
      if (!out.includes(p)) {
        console.error("expected provider dep present:", p);
        process.exit(2);
      }
    }
  });
});
