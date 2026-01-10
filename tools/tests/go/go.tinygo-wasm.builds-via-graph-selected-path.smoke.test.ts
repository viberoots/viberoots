#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function safeLogKeyFromLabel(label: string): string {
  return label.replace(/\//g, "_").replace(/:/g, "_");
}

test("nix_go_tiny_wasm_lib builds via graph-aware selected path (build-selected.ts)", async () => {
  await runInTemp("go-tinygo-wasm-build-via-selected-path", async (tmp, $) => {
    const apiDir = path.join(tmp, "libs", "math-api");
    await fs.mkdirp(apiDir);
    await fs.writeFile(
      path.join(apiDir, "go.mod"),
      "module example.com/math/api\n\ngo 1.22.0\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "main.go"),
      "package main\n\n//export add\nfunc add(a int32, b int32) int32 { return a + b }\n\nfunc main() {}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "TARGETS"),
      [
        'load("//go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        '    labels = ["lang:go", "kind:wasm"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const label = "//libs/math-api:wasm";
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`buck2 build --target-platforms prelude//platforms:default ${label}`;

    const logPath = `/tmp/go_nix_build_wasm_build.${safeLogKeyFromLabel(label)}.log`;
    assert.ok(await fs.pathExists(logPath), `expected build-selected log to exist: ${logPath}`);
    const log = await fs.readFile(logPath, "utf8");
    assert.match(log, /\[build-selected\] BUCK_TARGET=\/\/libs\/math-api:wasm/);
    assert.match(log, /\[build-selected\] (exporting graph to|using existing graph:)/);
  });
});
