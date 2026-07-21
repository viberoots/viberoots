#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";

test("python macros: nix_python_test runs via Nix-backed runner", async () => {
  await runInTemp("python-nix-test-runs", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pytester");
    const srcDir = path.join(appDir, "src", "pytester");
    const testsDir = path.join(appDir, "tests");
    const binDir = path.join(appDir, "bin");
    await fs.mkdirp(srcDir);
    await fs.mkdirp(testsDir);
    await fs.mkdirp(binDir);
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.writeFile(
      path.join(srcDir, "__init__.py"),
      ["def answer():", "    return 42", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(testsDir, "test_basic.py"),
      [
        "import unittest",
        "from pytester import answer",
        "",
        "class TestBasic(unittest.TestCase):",
        "    def test_answer(self):",
        "        self.assertEqual(answer(), 42)",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(binDir, "__main__.py"),
      [
        "import pathlib",
        "import sys",
        "import unittest",
        "",
        "def main():",
        "    root = pathlib.Path(__file__).resolve().parents[1]",
        "    sys.path.insert(0, str(root / 'src'))",
        "    suite = unittest.defaultTestLoader.discover(str(root / 'tests'))",
        "    result = unittest.TextTestRunner().run(suite)",
        "    raise SystemExit(0 if result.wasSuccessful() else 1)",
        "",
        "if __name__ == '__main__':",
        "    main()",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_library", "nix_python_test")',
        "",
        'nix_python_library(name = "pytester_lib", srcs = glob(["src/**/*.py"]))',
        'nix_python_test(name = "pytester_test", srcs = glob(["tests/**/*.py", "bin/__main__.py"]), deps = [":pytester_lib"])',
        "",
      ].join("\n"),
      "utf8",
    );
    await reconcileTempDependencyInputs(tmp, $);

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 test --target-platforms prelude//platforms:default //projects/apps/pytester:pytester_test`;
    assert.equal(res.exitCode, 0, `buck2 test failed:\n${String(res.stderr || res.stdout)}`);
  });
});
