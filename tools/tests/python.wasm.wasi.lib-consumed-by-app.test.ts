#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers.ts";

test("python wasm (wasi): app consumes wasm lib overlay", async () => {
  await runInTemp("py-wasm-wasi-lib-overlay", async (tmp, $) => {
    // Lib importer
    const libDir = path.join(tmp, "libs", "pylib");
    await fs.mkdir(path.join(libDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(libDir, "uv.lock"),
      ["[[package]]", 'name = "world"', 'version = "0.1.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendorLib = path.join(libDir, "vendor", "world");
    await fs.mkdir(path.join(vendorLib, "world"), { recursive: true });
    await fs.writeFile(path.join(vendorLib, "world", "__init__.py"), "FLAG=True\n", "utf8");
    await fs.writeFile(
      path.join(libDir, "TARGETS"),
      `
load("//python:defs.bzl", "nix_python_wasm_lib")
nix_python_wasm_lib(
  name = "pylib",
  lockfile_label = "lockfile:libs/pylib/uv.lock#libs/pylib",
  srcs = glob(["**/*.py"]),
  visibility = ["PUBLIC"],
)
`,
      "utf8",
    );
    // App that depends on the lib
    const appDir = path.join(tmp, "apps", "pywasm");
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), 'print("ok")\n', "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    const vendorApp = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendorApp, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendorApp, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//python:defs.bzl", "nix_python_wasm_app")
nix_python_wasm_app(
  name = "pyapp",
  lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
  srcs = [],
  deps = ["//libs/pylib:pylib"],
  visibility = ["PUBLIC"],
)
`,
      "utf8",
    );
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    const env = {
      ...process.env,
      BUCK_TARGET: "//apps/pywasm:pyapp",
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "apps/pywasm/vendor/hello" },
        world: { version: "0.1.0", originPath: "libs/pylib/vendor/world" },
      }),
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
    // Inspect the wasm banner via runner; it should mention overlays=1
    const runJs = path.join(outPath, "bin", "run.mjs");
    const runOut = await $`node ${runJs}`;
    const stdout = String(runOut.stdout || "");
    assert.match(stdout, /overlays=1/);
  });
});
