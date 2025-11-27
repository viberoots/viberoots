#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("extra_module_providers: non-list arg fails with generic labels error text", async () => {
  await runInTemp("macro-extra-providers-nonlist", async (tmp, $) => {
    // Minimal TARGETS using nix_go_library with an invalid type for extra_module_providers
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//go:defs.bzl", "nix_go_library")

genrule(name="localprov", cmd=": > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    # INVALID: should be a list; using a string should trigger a friendly generic message
    extra_module_providers = ":localprov",
)
EOF'`;
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//tmp:lib)"`.nothrow();
    const all = String(probe.stderr || "") + String(probe.stdout || "");
    if (probe.exitCode === 0) {
      console.error("expected buck2 to fail on non-list extra_module_providers");
      process.exit(2);
    }
    // Expect generic, argument-agnostic error text from normalize_labels(...)
    if (!all.includes("labels must be a list of string labels")) {
      console.error("missing generic labels error text in failure output:\n", all);
      process.exit(2);
    }
  });
});

test("extra_module_providers: list with non-string elements fails with generic labels error", async () => {
  await runInTemp("macro-extra-providers-bad-elem", async (tmp, $) => {
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//go:defs.bzl", "nix_go_library")

genrule(name="localprov", cmd=": > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    # INVALID: a non-string element should trigger the same generic error text
    extra_module_providers = [":localprov", 123],
)
EOF'`;
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//tmp:lib)"`.nothrow();
    const all = String(probe.stderr || "") + String(probe.stdout || "");
    if (probe.exitCode === 0) {
      console.error(
        "expected buck2 to fail when extra_module_providers list has non-string element",
      );
      process.exit(2);
    }
    if (!all.includes("labels must be a list of string labels")) {
      console.error("missing generic labels error text in failure output:\n", all);
      process.exit(2);
    }
  });
});
