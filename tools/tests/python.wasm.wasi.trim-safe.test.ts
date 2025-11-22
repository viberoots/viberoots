#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { runInTemp, exists } from "./lib/test-helpers.ts";

test("python wasm (wasi): trim:safe prunes caches/tests and preserves run", async () => {
  await runInTemp("py-wasm-wasi-trim-safe", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "pywasm");
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });
    // Minimal app entry
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), 'print("hello wasm")\n', "utf8");
    // Minimal uv.lock with one package
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      [
        "# uv lock (minimal for tests)",
        "",
        "[[package]]",
        'name = "hello"',
        'version = "1.0.0"',
        "",
      ].join("\n"),
      "utf8",
    );
    // Vendor source for hello with cache/tests to be pruned
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello", "__pycache__"), { recursive: true });
    await fs.mkdir(path.join(vendor, "hello", "tests"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");
    await fs.writeFile(path.join(vendor, "hello", "__pycache__", "dummy.pyc"), "", "utf8");
    await fs.writeFile(path.join(vendor, "hello", "tests", "dummy.txt"), "x", "utf8");

    // TARGETS using wasm app macro with explicit lockfile label and trim:safe
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    labels = ["trim:safe"],
    lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
    srcs = glob(["**/*.py"]),
)
`,
      "utf8",
    );
    // Export graph then build selected nix target
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const env = {
      ...process.env,
      BUCK_TARGET: "//apps/pywasm:pyapp",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
      }),
      EXPORTER_DEBUG: "1",
      BUCK_QUERY_ROOTS: "apps,libs,third_party,go,cpp",
    };
    const out = await $({
      cwd: tmp,
      env,
    })`nix build --impure -L --accept-flake-config '.#graph-generator-selected' --no-link --print-out-paths`;
    const outPath = String(out.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()!;
    const runJs = path.join(outPath, "bin", "run.mjs");
    const runOut = await $`node ${runJs}`;
    const stdout = String(runOut.stdout || "");
    assert.match(stdout, /python-wasi:wasi/);

    // Verify pruned paths
    assert.equal(
      await exists(path.join(outPath, "site", "hello", "__pycache__")),
      false,
      "__pycache__ should be removed",
    );
    assert.equal(
      await exists(path.join(outPath, "site", "hello", "tests")),
      false,
      "tests/ should be removed",
    );
  });
});
