#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("buck builds Go and Python using Nix toolchains", async () => {
  const prev = process.env.TEST_NEED_DEV_ENV;
  try {
    process.env.TEST_NEED_DEV_ENV = "1";
    await runInTemp("toolchains-buck-nix", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      const pkg = path.join(tmp, "projects", "apps", "toolchain-demo");
      await fsp.mkdir(pkg, { recursive: true });
      await fsp.writeFile(
        path.join(pkg, "main.go"),
        `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ok") }\n`,
        "utf8",
      );
      await fsp.writeFile(
        path.join(pkg, "app.py"),
        `def main() -> None:\n    print("ok")\n`,
        "utf8",
      );
      const targets = [
        'load("@prelude//:rules.bzl", "go_binary", "python_binary", "python_library")',
        "",
        "go_binary(",
        '    name = "go_bin",',
        '    srcs = ["main.go"],',
        ")",
        "",
        "python_library(",
        '    name = "py_lib",',
        '    srcs = ["app.py"],',
        ")",
        "",
        "python_binary(",
        '    name = "py_bin",',
        '    main_module = "app",',
        '    deps = [":py_lib"],',
        ")",
        "",
      ].join("\n");
      await fsp.writeFile(path.join(pkg, "TARGETS"), targets, "utf8");

      const goRes =
        await $`buck2 build --target-platforms //:no_cgo //projects/apps/toolchain-demo:go_bin`.nothrow();
      const pyRes =
        await $`buck2 build --target-platforms //:no_cgo //projects/apps/toolchain-demo:py_bin`.nothrow();
      assert.equal(goRes.exitCode, 0, `go build failed: ${goRes.stderr}`);
      assert.equal(pyRes.exitCode, 0, `python build failed: ${pyRes.stderr}`);
    });
  } finally {
    if (prev === undefined) delete process.env.TEST_NEED_DEV_ENV;
    else process.env.TEST_NEED_DEV_ENV = prev;
  }
});
