#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { buildSelectedOutPath, exportGraphInTemp, runInTemp } from "../lib/test-helpers";

test("wasm: tinygo per-dep link closure overrides are observable and deterministic", async () => {
  await runInTemp("wasm-tinygo-link-closure-overrides", async (tmp, $) => {
    const mkLib = async (dirName: string, name: string, opts?: { linkDeps?: string[] }) => {
      const dir = path.join(tmp, "projects", "libs", dirName);
      await fs.outputFile(path.join(dir, "include", `${dirName}.h`), `int ${dirName}_id(void);\n`);
      await fs.outputFile(
        path.join(dir, "src", `${dirName}.c`),
        `int ${dirName}_id(void) { return 1; }\n`,
      );
      await fs.outputFile(
        path.join(dir, "TARGETS"),
        [
          'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
          "",
          "nix_cpp_wasm_static_lib(",
          `    name = "${name}",`,
          `    srcs = ["src/${dirName}.c"],`,
          `    headers = ["include/${dirName}.h"],`,
          ...(opts?.linkDeps ? [`    link_deps = ${JSON.stringify(opts.linkDeps)},`] : []),
          '    labels = ["kind:lib"],',
          '    wasm_abi = "wasi",',
          '    visibility = ["PUBLIC"],',
          ")",
          "",
        ].join("\n"),
      );
    };

    await mkLib("support", "support_wasm");
    await mkLib("core", "core_wasm", { linkDeps: ["//projects/libs/support:support_wasm"] });
    await mkLib("util", "util_wasm");

    const apiDir = path.join(tmp, "projects", "libs", "api");
    await fs.outputFile(path.join(apiDir, "go.mod"), `module example.com/api\n\ngo 1.22.0\n`);
    await fs.outputFile(path.join(apiDir, "main.go"), `package main\n\nfunc main() {}\n`);
    await fs.outputFile(
      path.join(apiDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        '    link_deps = ["//projects/libs/core:core_wasm", "//projects/libs/util:util_wasm"],',
        '    link_closure = "direct",',
        "    link_closure_overrides = {",
        '        "//projects/libs/core:core_wasm": "transitive",',
        "    },",
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
    );

    await exportGraphInTemp({ tmp, $ });

    const outPath = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    const log = await fs.readFile(path.join(outPath, "build.log"), "utf8");

    const libLabels =
      log
        .split("\n")
        .find((l) => l.startsWith("wasmStaticLibLabels="))
        ?.trim() || "";
    const overrides =
      log
        .split("\n")
        .find((l) => l.startsWith("linkClosureOverrides="))
        ?.trim() || "";

    const expectedLabels =
      "wasmStaticLibLabels=//projects/libs/core:core_wasm,//projects/libs/support:support_wasm,//projects/libs/util:util_wasm";
    const expectedOverrides = "linkClosureOverrides=//projects/libs/core:core_wasm=transitive";

    if (!libLabels || !overrides) throw new Error("missing build.log diagnostics for wasm linkage");
    if (libLabels !== expectedLabels)
      throw new Error(`expected wasmStaticLibLabels ${expectedLabels}; got ${libLabels}`);
    if (overrides !== expectedOverrides)
      throw new Error(`expected linkClosureOverrides ${expectedOverrides}; got ${overrides}`);
  });
});
