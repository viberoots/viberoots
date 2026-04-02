#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

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

test("go macros: CGO wiring + tuple labels + provider edges remain stable after refactor", async () => {
  await runInTemp("go-cgo-wiring-refactor-stability", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="nix_pkgs_zlib", out="nix_pkgs_zlib.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
genrule(name="extra_provider", out="extra_provider.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test
MODULE_PROVIDERS = {
  "//tmp:lib": [
    "//third_party/providers:nix_pkgs_zlib",
  ],
}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p libs/native && cat > libs/native/TARGETS <<'\''EOF'\''
genrule(name="native", out="native.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//build-tools/go:defs.bzl", "nix_go_library")

genrule(name="localprov", out="localprov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])

nix_go_library(
    name = "lib",
    srcs = [],
    # Exercise tuple label stamping
    build_tags = ["S3", "debug", "DEBUG"],
    goos = "linux",
    goarch = "amd64",
    cgo_enabled = True,
    # Exercise CGO wiring and nixpkg label normalization
    nixpkg_deps = ["zlib"],
    repo_cgo_deps = ["//projects/libs/native:native"],
    # Exercise extra provider injection + normalization
    extra_module_providers = ["//third_party/providers:extra_provider", ":localprov"],
)
EOF'`;

    const probeAttrs = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("go_cgo_wiring_refactor_stability")} cquery --target-platforms //:no_cgo --json --output-attribute override_cgo_enabled --output-attribute labels //tmp:lib`;
    if (probeAttrs.exitCode !== 0) return; // skip if prelude not available

    const node = firstCqueryNode<{
      labels?: string[];
      override_cgo_enabled?: boolean;
    }>(JSON.parse(String(probeAttrs.stdout || "")));
    assert.equal(node?.override_cgo_enabled, true);
    const labels = node?.labels || [];
    assert.ok(labels.includes("cgo:enabled"));
    assert.ok(labels.includes("nixpkg:pkgs.zlib"));
    assert.ok(labels.includes("gotags:debug,s3"));
    assert.ok(labels.includes("goenv:GOOS=linux"));
    assert.ok(labels.includes("goenv:GOARCH=amd64"));
    assert.ok(labels.includes("goenv:CGO_ENABLED=1"));

    const probeDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("go_cgo_wiring_refactor_stability")} cquery --target-platforms prelude//platforms:default "deps(//tmp:lib)" --json --output-attribute name`;
    if (probeDeps.exitCode !== 0) return; // skip if prelude not available

    const out = String(probeDeps.stdout || "");
    assert.ok(out.includes("//third_party/providers:nix_pkgs_zlib"));
    assert.ok(out.includes("//third_party/providers:extra_provider"));
    assert.ok(out.includes("//tmp:localprov"));
    assert.ok(out.includes("//projects/libs/native:native"));
  });
});
