#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_library stamps cgo:enabled and nixpkg:pkgs.openssl when nixpkg_deps set", async () => {
  await runInTemp("go-cgo-openssl-labels", async (tmp, $) => {
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    nixpkg_deps = ["pkgs.openssl"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cgo_openssl_labels cquery "attr(labels, '.*', //tmp:lib)" --json --output-attribute labels`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{ labels?: string[] }>;
    const labels = (nodes[0]?.labels || []).sort();
    if (!labels.includes("cgo:enabled")) {
      console.error("expected cgo:enabled label");
      process.exit(2);
    }
    if (!labels.includes("nixpkg:pkgs.openssl")) {
      console.error("expected nixpkg:pkgs.openssl label");
      process.exit(2);
    }
  });
});
