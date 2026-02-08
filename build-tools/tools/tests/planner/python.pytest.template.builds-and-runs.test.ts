#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { sanitizeName } from "../../lib/sanitize";
import { runInTemp } from "../lib/test-helpers";

test("planner builds python test and runs via selected target", async () => {
  await runInTemp("planner-python-test-selected", async (tmp, $) => {
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

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    const target = "//projects/apps/pytester:pytester_tests";
    const node = {
      name: target,
      rule_type: "python_test",
      labels: ["lang:python", "kind:test"],
      srcs: [
        "projects/apps/pytester/src/pytester/__init__.py",
        "projects/apps/pytester/tests/test_basic.py",
        "projects/apps/pytester/bin/__main__.py",
      ],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );

    const { stdout, stderr, exitCode } = await $({
      cwd: tmp,
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TEST_SRC: tmp,
        BUCK_TARGET: target,
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;

    if (exitCode !== 0) {
      console.error(stderr);
      process.exit(2);
    }
    const outPath =
      String(stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) {
      console.error("expected an out path from graph-generator-selected");
      process.exit(2);
    }

    const runner = path.join(outPath, "bin", `pytest-${sanitizeName(target)}`);
    const runRes = await $({
      cwd: tmp,
      reject: false,
      nothrow: true,
      stdio: "pipe",
    })`${runner}`;
    if (runRes.exitCode !== 0) {
      console.error(runRes.stderr);
      process.exit(2);
    }
  });
});
