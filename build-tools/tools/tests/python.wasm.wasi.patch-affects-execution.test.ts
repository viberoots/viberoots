#!/usr/bin/env zx-wrapper
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";

test("python wasm (wasi): patch affects execution banner", async () => {
  await runInTemp("py-wasm-wasi-patch", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pywasm");
    await fs.mkdir(path.join(appDir, "bin"), { recursive: true });
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });
    await fs.mkdir(path.join(appDir, "patches", "python"), { recursive: true });
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), 'print("start")\n', "utf8");
    await fs.writeFile(
      path.join(appDir, "uv.lock"),
      ["[[package]]", 'name = "hello"', 'version = "1.0.0"'].join("\n") + "\n",
      "utf8",
    );
    // Vendor distribution
    const vendor = path.join(appDir, "vendor", "hello");
    await fs.mkdir(path.join(vendor, "hello"), { recursive: true });
    await fs.writeFile(path.join(vendor, "hello", "__init__.py"), 'VALUE="one"\n', "utf8");
    // TARGETS
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("//build-tools/python:defs.bzl", "nix_python_wasm_app")
nix_python_wasm_app(
  name = "pyapp",
  lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
  srcs = glob(["**/*.py"]),
)
`,
      "utf8",
    );
    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    const env = {
      ...process.env,
      BUCK_TARGET: "//projects/apps/pywasm:pyapp",
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        hello: { version: "1.0.0", originPath: "projects/apps/pywasm/vendor/hello" },
      }),
    };
    // First build: no patches
    const out1 = await $({
      cwd: tmp,
      env,
    })`nix build --impure -L --accept-flake-config ${`path:${tmp}#graph-generator-selected`} --no-link --print-out-paths`;
    const outPath1 = String(out1.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()!;
    const runJs1 = path.join(outPath1, "bin", "run.mjs");
    const runOut1 = await $`node ${runJs1}`;
    const stdout1 = String(runOut1.stdout || "");
    assert.match(stdout1, /patched=none/);
    // Add a patch that targets hello@1.0.0 (contents don't matter for banner)
    const patchPath = path.join(appDir, "patches", "python", "hello@1.0.0.patch");
    await fs.writeFile(
      patchPath,
      [
        "--- a/hello/__init__.py",
        "+++ b/hello/__init__.py",
        "@@",
        '-VALUE="one"',
        '+VALUE="two"',
      ].join("\n") + "\n",
      "utf8",
    );
    // Rebuild
    const out2 = await $({
      cwd: tmp,
      env,
    })`nix build --impure -L --accept-flake-config ${`path:${tmp}#graph-generator-selected`} --no-link --print-out-paths`;
    const outPath2 = String(out2.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()!;
    const runJs2 = path.join(outPath2, "bin", "run.mjs");
    const runOut2 = await $`node ${runJs2}`;
    const stdout2 = String(runOut2.stdout || "");
    assert.match(stdout2, /patched=hello@1\.0\.0/);
  });
});
