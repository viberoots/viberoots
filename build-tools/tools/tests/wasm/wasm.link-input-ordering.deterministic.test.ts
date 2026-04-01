#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { buildSelectedOutPath, exportGraphInTemp, runInTemp } from "../lib/test-helpers";

test("wasm: link input ordering is deterministic (logged by template)", async () => {
  await runInTemp("wasm-link-input-ordering-deterministic", async (tmp, $) => {
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
          'load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
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
    await mkLib("util", "util_wasm", { linkDeps: ["//projects/libs/support:support_wasm"] });

    const apiDir = path.join(tmp, "projects", "libs", "api");
    await fs.outputFile(path.join(apiDir, "go.mod"), `module example.com/api\n\ngo 1.22.0\n`);
    await fs.outputFile(path.join(apiDir, "main.go"), `package main\n\nfunc main() {}\n`);
    await fs.outputFile(
      path.join(apiDir, "TARGETS"),
      [
        'load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        '    link_deps = ["//projects/libs/core:core_wasm", "//projects/libs/util:util_wasm"],',
        '    link_closure = "transitive",',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
    );

    await exportGraphInTemp({ tmp, $ });

    const out1 = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    const out2 = await buildSelectedOutPath({
      tmp,
      $,
      target: "//projects/libs/api:wasm",
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });

    const log1 = await fs.readFile(path.join(out1, "build.log"), "utf8");
    const log2 = await fs.readFile(path.join(out2, "build.log"), "utf8");
    const line = (log: string) =>
      log
        .split("\n")
        .find((l) => l.startsWith("wasmStaticLibLabels="))
        ?.trim() || "";
    const got1 = line(log1);
    const got2 = line(log2);
    if (!got1 || !got2) throw new Error("missing wasmStaticLibLabels line in build.log");
    if (got1 !== got2)
      throw new Error(
        `expected deterministic wasmStaticLibLabels across builds; got:\n${got1}\n${got2}`,
      );

    const expected =
      "wasmStaticLibLabels=//projects/libs/core:core_wasm,//projects/libs/support:support_wasm,//projects/libs/util:util_wasm";
    if (got1 !== expected) throw new Error(`expected resolved ordering ${expected}; got ${got1}`);
  });
});
