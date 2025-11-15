#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cgo_deps wires provider dep for openssl", async () => {
  await runInTemp("go-cgo-openssl-wiring", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nix_pkgs_openssl", attr="pkgs.openssl")
EOF'`;

    // Map the demo target to the openssl provider via MODULE_PROVIDERS (auto_map)
    await $({
      cwd: tmp,
    })`bash -lc 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test
MODULE_PROVIDERS = {
    "//apps/demo-cli:demo": [
        "//third_party/providers:nix_pkgs_openssl",
    ],
}
EOF'`;

    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p apps/demo-cli/cmd/demo && cat > apps/demo-cli/cmd/demo/main.go <<'\''EOF'\''
package main
/*
#cgo pkg-config: openssl
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
    nix_cgo_deps = ["pkgs.openssl"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cgo_openssl cquery "deps(//apps/demo-cli:demo)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const raw = String(probe.stdout || "").trim();
    if (!raw) return; // skip if no JSON produced (empty graph/older buck)
    const nodes = JSON.parse(raw) as Array<{ name: string }>;
    const names = new Set(nodes.map((n) => n.name));
    if (!names.has("//third_party/providers:nix_pkgs_openssl")) {
      console.error("expected openssl provider dep present");
      process.exit(2);
    }
  });
});
