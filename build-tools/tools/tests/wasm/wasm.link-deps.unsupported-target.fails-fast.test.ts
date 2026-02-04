#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("wasm: unsupported target in link_deps fails fast with targeted error", async () => {
  await runInTemp("wasm-link-deps-unsupported-target", async (tmp, $) => {
    const appDir = path.join(tmp, "libs", "api");
    await fs.outputFile(path.join(appDir, "go.mod"), `module example.com/api\n\ngo 1.22.0\n`);
    await fs.outputFile(path.join(appDir, "main.go"), `package main\n\nfunc main() {}\n`);
    await fs.outputFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        'genrule(name = "not_wasm", out = "x.txt", cmd = "echo x > $OUT")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        '    link_deps = [":not_wasm"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
    );

    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/api:wasm", WEB_WASM_BACKEND: "wasi_single" },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;

    if (res.exitCode === 0) {
      throw new Error("expected build-selected to fail on unsupported link_deps, but it succeeded");
    }
    const combined = `${String(res.stdout || "")}\n${String(res.stderr || "")}`;
    if (
      !combined.includes("link_dep") ||
      !combined.includes("//libs/api:wasm") ||
      !combined.includes("//libs/api:not_wasm")
    ) {
      throw new Error(`expected error to name consumer and offending dep; got:\n${combined}`);
    }
    if (
      !combined.includes("expected labels") ||
      !combined.includes("lang:cpp") ||
      !combined.includes("wasm:static")
    ) {
      throw new Error(`expected error to mention required labels; got:\n${combined}`);
    }
  });
});
