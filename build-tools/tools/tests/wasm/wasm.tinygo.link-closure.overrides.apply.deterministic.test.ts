#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function buildSelectedOutPath(args: {
  tmp: string;
  $: any;
  target: string;
}): Promise<string> {
  const { tmp, $, target } = args;
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    env: { ...process.env, BUCK_TARGET: target, WEB_WASM_BACKEND: "wasi_single" },
  })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\n+/)
      .pop() || "";
  if (!outPath) throw new Error("no out path emitted by build-selected.ts");
  return outPath;
}

test("wasm: tinygo per-dep link closure overrides are observable and deterministic", async () => {
  await runInTemp("wasm-tinygo-link-closure-overrides", async (tmp, $) => {
    const mkLib = async (dirName: string, name: string, opts?: { linkDeps?: string[] }) => {
      const dir = path.join(tmp, "libs", dirName);
      await fs.outputFile(path.join(dir, "include", `${dirName}.h`), `int ${dirName}_id(void);\n`);
      await fs.outputFile(
        path.join(dir, "src", `${dirName}.c`),
        `int ${dirName}_id(void) { return 1; }\n`,
      );
      await fs.outputFile(
        path.join(dir, "TARGETS"),
        [
          'load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
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
    await mkLib("core", "core_wasm", { linkDeps: ["//libs/support:support_wasm"] });
    await mkLib("util", "util_wasm");

    const apiDir = path.join(tmp, "libs", "api");
    await fs.outputFile(path.join(apiDir, "go.mod"), `module example.com/api\n\ngo 1.22.0\n`);
    await fs.outputFile(path.join(apiDir, "main.go"), `package main\n\nfunc main() {}\n`);
    await fs.outputFile(
      path.join(apiDir, "TARGETS"),
      [
        'load("//go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '    name = "wasm",',
        '    srcs = ["main.go"],',
        '    link_deps = ["//libs/core:core_wasm", "//libs/util:util_wasm"],',
        '    link_closure = "direct",',
        "    link_closure_overrides = {",
        '        "//libs/core:core_wasm": "transitive",',
        "    },",
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
    );

    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    const outPath = await buildSelectedOutPath({ tmp, $, target: "//libs/api:wasm" });
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
      "wasmStaticLibLabels=//libs/core:core_wasm,//libs/support:support_wasm,//libs/util:util_wasm";
    const expectedOverrides = "linkClosureOverrides=//libs/core:core_wasm=transitive";

    if (!libLabels || !overrides) throw new Error("missing build.log diagnostics for wasm linkage");
    if (libLabels !== expectedLabels)
      throw new Error(`expected wasmStaticLibLabels ${expectedLabels}; got ${libLabels}`);
    if (overrides !== expectedOverrides)
      throw new Error(`expected linkClosureOverrides ${expectedOverrides}; got ${overrides}`);
  });
});
