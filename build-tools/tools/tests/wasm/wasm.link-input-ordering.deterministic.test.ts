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

test("wasm: link input ordering is deterministic (logged by template)", async () => {
  await runInTemp("wasm-link-input-ordering-deterministic", async (tmp, $) => {
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
    await mkLib("util", "util_wasm", { linkDeps: ["//libs/support:support_wasm"] });

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
        '    link_closure = "transitive",',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
    );

    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    const out1 = await buildSelectedOutPath({ tmp, $, target: "//libs/api:wasm" });
    const out2 = await buildSelectedOutPath({ tmp, $, target: "//libs/api:wasm" });

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
      "wasmStaticLibLabels=//libs/core:core_wasm,//libs/support:support_wasm,//libs/util:util_wasm";
    if (got1 !== expected) throw new Error(`expected resolved ordering ${expected}; got ${got1}`);
  });
});
