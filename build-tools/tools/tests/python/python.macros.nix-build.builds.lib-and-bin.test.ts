#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros: nix_python_library and nix_python_binary build", async () => {
  await runInTemp("python-nix-builds-lib-bin", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pyapp");
    await fs.mkdirp(path.join(appDir, "src", "pyapp"));
    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.writeFile(path.join(appDir, "src", "pyapp", "__init__.py"), "value = 1\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      ["def main():", "    print('ok')", "", "if __name__ == '__main__':", "    main()", ""].join(
        "\n",
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_binary", "nix_python_library")',
        "",
        'nix_python_library(name = "pyapp_lib", srcs = glob(["src/**/*.py"]))',
        'nix_python_binary(name = "pyapp", deps = [":pyapp_lib"], main = "bin/__main__.py")',
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --show-output //projects/apps/pyapp:pyapp_lib //projects/apps/pyapp:pyapp`;
    assert.equal(res.exitCode, 0, `buck2 build failed:\n${String(res.stderr || res.stdout)}`);
  });
});
