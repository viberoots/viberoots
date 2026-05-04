#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";

test("python wasm (wasi): build-and-run prints wasi banner", async () => {
  await runInTemp("py-wasm-wasi-build-run", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pywasm");
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });
    // Minimal app entry (not executed by WASI baseline; kept for future)
    await fs.writeFile(
      path.join(appDir, "bin", "__main__.py"),
      'print("hello from python app")\n',
      "utf8",
    );
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
    // Vendor source for hello (used by uv backend materialization)
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");
    // TARGETS using wasm app macro with explicit lockfile label
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//build-tools/python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    labels = [],
    lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
    srcs = glob(["**/*.py"]),
)
`,
      "utf8",
    );
    // Export graph then build selected nix target
    await $`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
    const env = {
      ...process.env,
      BUCK_TARGET: "//projects/apps/pywasm:pyapp",
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      // Provide deterministic mapping for the uv backend to find vendor sources
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "projects/apps/pywasm/vendor/hello" },
      }),
      EXPORTER_DEBUG: "1",
      BUCK_QUERY_ROOTS: "projects/apps,projects/libs,third_party,go,cpp",
    };
    const out = await $({
      cwd: tmp,
      env,
    })`nix build --impure -L --accept-flake-config ${`path:${tmp}#graph-generator-selected`} --no-link --print-out-paths`;
    const outPath = String(out.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()!;
    const runJs = path.join(outPath, "bin", "run.mjs");
    const runOut = await $`node ${runJs}`;
    const stdout = String(runOut.stdout || "");
    assert.match(stdout, /python-wasi:wasi/);
  });
});
