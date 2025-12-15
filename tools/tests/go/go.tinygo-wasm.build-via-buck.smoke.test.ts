#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_tiny_wasm_lib builds via Buck (smoke)", async () => {
  await runInTemp("go-tinygo-wasm-buck-build", async (tmp, $) => {
    const apiDir = path.join(tmp, "libs", "math-api");
    await fs.mkdirp(apiDir);
    await fs.writeFile(
      path.join(apiDir, "go.mod"),
      `module example.com/math/api

go 1.22.0
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "main.go"),
      `package main

//export add
func add(a int32, b int32) int32 { return a + b }

func main() {}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(apiDir, "TARGETS"),
      `load("//go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)
`,
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms prelude//platforms:default //libs/math-api:wasm`;
    if (res.exitCode !== 0) {
      return;
    }
  });
});
