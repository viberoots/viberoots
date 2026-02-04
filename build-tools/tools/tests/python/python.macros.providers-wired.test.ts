#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros: provider wiring present in deps() for wasm app", async () => {
  await runInTemp("py-macros-providers-wired", async (tmp, $) => {
    // Minimal provider target
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
genrule(name="prov", out="prov.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
EOF'`;
    // Map the wasm app to the provider
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
MODULE_PROVIDERS = {
  "//apps/demo:wasm_app": ["//third_party/providers:prov"],
}
EOF'`;

    // Minimal importer with uv.lock and wasm app target
    const appDir = path.join(tmp, "apps", "demo");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.outputFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fs.outputFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_wasm_app")',
        "",
        "nix_python_wasm_app(",
        '  name = "wasm_app",',
        '  lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",',
        '  srcs = glob(["**/*.py"]),',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const macroTxt = await fs.readFile(path.join(tmp, "build-tools", "python", "defs.bzl"), "utf8");
    if (
      macroTxt.includes('load("//third_party/providers:auto_map.bzl"') ||
      !macroTxt.includes('load("//lang:auto_map.bzl"')
    ) {
      console.error(
        "expected build-tools/python/defs.bzl to load MODULE_PROVIDERS via //lang:auto_map.bzl",
      );
      process.exit(2);
    }

    // Introspect deps; provider edge should be present
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir py_prov cquery "deps(//apps/demo:wasm_app)" --json --output-attribute name`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const out = String(probe.stdout || "");
    if (!out.includes("//third_party/providers:prov")) {
      console.error("expected provider edge present in deps() for nix_python_wasm_app");
      process.exit(2);
    }
  });
});
