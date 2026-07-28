#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { rustPatchFilename } from "../../patch/rust-sync-required";
import { exportGraphInTemp, runInTemp } from "../lib/test-helpers";
import {
  assertResolvedNativeInputs,
  checksum,
  nativePatchText,
  registry,
  rustLeafPatchText,
  version,
} from "./rust.interop-patch-fixture";
import { rustPkgsExpression } from "./rust-nixpkgs-authority";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");

test("interop patches invalidate each bridge direction and restore exact outputs", async () => {
  for (const kind of ["c", "cxx"] as const) {
    await runInTemp(`rust-interop-${kind}-patch-invalidation`, async (tmp, $) => {
      const native = path.join(tmp, "projects/libs/interop_native");
      const core = path.join(tmp, "projects/libs/interop_core");
      const bridge = path.join(tmp, "projects/libs/interop_bridge");
      const app = path.join(tmp, "projects/apps/interop_consumer");
      await Promise.all([
        fs.mkdir(path.join(native, "src"), { recursive: true }),
        fs.mkdir(path.join(core, "src"), { recursive: true }),
        fs.mkdir(path.join(bridge, "src"), { recursive: true }),
        fs.mkdir(path.join(app, "src"), { recursive: true }),
      ]);
      const extension = kind === "c" ? "c" : "cpp";
      const header = kind === "c" ? "native.h" : "native.hpp";
      await fs.mkdir(path.join(native, "include"), { recursive: true });
      await fs.writeFile(
        path.join(native, "src", `support.${extension}`),
        '#include "../include/support.h"\nint support_value(void) { return 38; }\n',
      );
      await fs.writeFile(
        path.join(native, "src", `native.${extension}`),
        `#include "../include/${header}"\n#include "../include/offset.h"\n#include "../include/support.h"\nint native_value(void) { return support_value() + NATIVE_OFFSET; }\n`,
      );
      await fs.writeFile(path.join(native, "include", header), "int native_value(void);\n");
      await fs.writeFile(path.join(native, "include", "support.h"), "int support_value(void);\n");
      await fs.writeFile(path.join(native, "include", "offset.h"), "#define NATIVE_OFFSET 0\n");
      await fs.writeFile(
        path.join(native, "TARGETS"),
        [
          'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_headers", "nix_cpp_library")',
          `nix_cpp_headers(name="headers", ${kind === "c" ? 'language_standard="c11", stl="none", ' : ""}srcs=["include/${header}", "include/support.h", "include/offset.h"], visibility=["PUBLIC"])`,
          `nix_cpp_library(name="support", ${kind === "c" ? 'language_standard="c11", stl="none", ' : ""}srcs=["src/support.${extension}"], header_deps=[":headers"], visibility=["PUBLIC"])`,
          `nix_cpp_library(name="native", ${kind === "c" ? 'language_standard="c11", stl="none", ' : ""}srcs=["src/native.${extension}"], link_deps=[":support"], header_deps=[":headers"], link_closure="transitive", visibility=["PUBLIC"])`,
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(core, "Cargo.toml"),
        [
          "[package]",
          'name="interop_core"',
          'version="0.1.0"',
          'edition="2021"',
          "[dependencies]",
          `itoa="${version}"`,
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(core, "Cargo.lock"),
        [
          "version = 3",
          "",
          "[[package]]",
          'name = "interop_core"',
          'version = "0.1.0"',
          "dependencies = [",
          ' "itoa",',
          "]",
          "",
          "[[package]]",
          'name = "itoa"',
          `version = "${version}"`,
          `source = "${registry}"`,
          `checksum = "${checksum}"`,
          "",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(core, "src/lib.rs"),
        [
          "pub fn formatted_one() -> i32 {",
          "  let mut buffer = itoa::Buffer::new();",
          "  buffer.format(1).parse().unwrap()",
          "}",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(core, "TARGETS"),
        [
          'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")',
          'rust_library(name="core", crate="interop_core", srcs=["src/lib.rs"], visibility=["PUBLIC"])',
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(bridge, "Cargo.toml"),
        [
          "[package]",
          'name="interop_bridge"',
          'version="0.1.0"',
          'edition="2021"',
          "[lib]",
          'crate-type=["staticlib"]',
          "[dependencies]",
          'interop_core={path="../interop_core"}',
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(bridge, "Cargo.lock"),
        [
          "version = 3",
          "",
          "[[package]]",
          'name = "interop_bridge"',
          'version = "0.1.0"',
          "dependencies = [",
          ' "interop_core",',
          "]",
          "",
          "[[package]]",
          'name = "interop_core"',
          'version = "0.1.0"',
          "dependencies = [",
          ' "itoa",',
          "]",
          "",
          "[[package]]",
          'name = "itoa"',
          `version = "${version}"`,
          `source = "${registry}"`,
          `checksum = "${checksum}"`,
          "",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(bridge, "src/lib.rs"),
        [
          "#[no_mangle]",
          'pub extern "C" fn rust_answer() -> i32 {',
          "  unsafe { __viberoots_abi::vbr_native_value() + interop_core::formatted_one() }",
          "}",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(bridge, "bindings.json"),
        `${JSON.stringify({
          schema: "viberoots.rust-interop.v1",
          headers: [header],
          functions: [
            { name: "rust_answer", return: "i32", params: [] },
            {
              name: "vbr_native_value",
              ...(kind === "c" ? { native_name: "native_value" } : { cpp_name: "native_value" }),
              direction: "import",
              header,
              return: "i32",
              ...(kind === "cxx" ? { error_value: -1 } : {}),
              params: [],
            },
          ],
        })}\n`,
      );
      await fs.writeFile(
        path.join(bridge, "TARGETS"),
        [
          `load("@viberoots//build-tools/rust:defs.bzl", "${kind === "c" ? "rust_c_ffi_library" : "rust_cxx_bridge_library"}")`,
          `${kind === "c" ? "rust_c_ffi_library" : "rust_cxx_bridge_library"}(name="bridge", binding_config="bindings.json", ${kind === "cxx" ? 'exception_policy="contained", ' : ""}crate="interop_bridge", public_crate="interop_bridge", srcs=["src/lib.rs"], deps=["//projects/libs/interop_core:core"], link_deps=["//projects/libs/interop_native:native"], header_deps=["//projects/libs/interop_native:headers"], link_closure="direct", link_closure_overrides={"//projects/libs/interop_native:native": "transitive"}, visibility=["PUBLIC"])`,
        ].join("\n"),
      );
      const appExtension = kind === "c" ? "c" : "cpp";
      await fs.writeFile(
        path.join(app, `src/main.${appExtension}`),
        kind === "c"
          ? '#include <stdio.h>\n#include <interop_bridge.h>\nint main(void) { printf("%d\\n", rust_answer()); }\n'
          : '#include <iostream>\n#include <interop_bridge.hpp>\nint main() { std::cout << interop_bridge::rust_answer() << "\\n"; }\n',
      );
      await fs.writeFile(
        path.join(app, "TARGETS"),
        [
          'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
          `nix_cpp_binary(name="app", ${kind === "c" ? 'language_standard="c11", stl="none", ' : ""}srcs=["src/main.${appExtension}"], link_deps=["//projects/libs/interop_bridge:bridge"], header_deps=["//projects/libs/interop_bridge:bridge"], link_closure="transitive")`,
        ].join("\n"),
      );
      const rustPatchDir = path.join(core, "patches/rust");
      await fs.mkdir(rustPatchDir, { recursive: true });
      const rustPatch = path.join(rustPatchDir, rustPatchFilename("itoa", version, registry));
      const rustBaselinePatch = rustLeafPatchText("never");
      await fs.writeFile(rustPatch, rustBaselinePatch);
      const cppPatchDir = path.join(native, "patches/cpp");
      await fs.mkdir(cppPatchDir, { recursive: true });
      const cppPatch = path.join(cppPatchDir, "interop_native@0.0.0.patch");
      const cppPatchText = (supportValue: number, offsetValue: number) =>
        nativePatchText(extension, supportValue, offsetValue);
      const cppBaselinePatch = cppPatchText(39, 1);
      await fs.writeFile(cppPatch, cppBaselinePatch);
      const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
      const generator = path.join(sourceRoot, "build-tools/tools/nix/graph-generator.nix");
      const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
      const target = "//projects/apps/interop_consumer:app";
      await exportGraphInTemp({ tmp, $ });
      await assertResolvedNativeInputs($, tmp, generator, graph, rustPkgsExpression);
      const build = async () => {
        await exportGraphInTemp({ tmp, $ });
        const result = await $({
          cwd: tmp,
          env: { ...process.env, BUCK_TARGET: target },
          stdio: "pipe",
        })`nix build --impure --accept-flake-config --file ${generator} selected --arg pkgs ${rustPkgsExpression} --arg src ./. --argstr system ${system} --argstr graphJsonPath ${graph} --no-link --print-out-paths`;
        const output = String(result.stdout).trim().split("\n").at(-1);
        assert.ok(output?.startsWith("/nix/store/"));
        const executable = path.join(output, "bin/projects-apps-interop_consumer-app");
        const run = await $({ cwd: tmp, stdio: "pipe" })`${executable}`;
        return { output, value: String(run.stdout).trim() };
      };
      const baseline = await build();
      assert.equal(baseline.value, "41");

      await fs.writeFile(rustPatch, rustLeafPatchText("1"));
      const rustPatched = await build();
      assert.equal(rustPatched.value, "42");
      assert.notEqual(rustPatched.output, baseline.output);
      await fs.writeFile(rustPatch, rustBaselinePatch);
      const rustRestored = await build();
      assert.deepEqual(rustRestored, baseline);

      await fs.writeFile(cppPatch, cppPatchText(40, 1));
      const sourcePatched = await build();
      assert.equal(sourcePatched.value, "42");
      assert.notEqual(sourcePatched.output, baseline.output);
      await fs.writeFile(cppPatch, cppPatchText(39, 2));
      const headerPatched = await build();
      assert.equal(headerPatched.value, "42");
      assert.notEqual(headerPatched.output, baseline.output);
      assert.notEqual(headerPatched.output, sourcePatched.output);
      await fs.writeFile(cppPatch, cppBaselinePatch);
      const restored = await build();
      assert.deepEqual(restored, baseline);
    });
  }
});
