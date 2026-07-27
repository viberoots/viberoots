#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const generator = path.join(
  sourceRoot,
  "build-tools/tools/nix/templates/rust-interop-generate.mjs",
);

test("reviewed C imports emit a genuine C shim", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rust-interop-c-schema-"));
  try {
    const config = path.join(tmp, "bindings.json");
    const output = path.join(tmp, "out");
    await fs.writeFile(
      config,
      `${JSON.stringify({
        schema: "viberoots.rust-interop.v1",
        headers: ["native.h"],
        functions: [
          { name: "rust_value", return: "i32", params: [] },
          {
            name: "vbr_native_value",
            native_name: "native_value",
            direction: "import",
            header: "native.h",
            return: "i32",
            params: [],
          },
        ],
      })}\n`,
    );
    await $`${process.execPath} ${generator} ${config} ${output} c_bridge c none abort caller send-sync c11`;
    const shim = await fs.readFile(path.join(output, "c_bridge.c"), "utf8");
    assert.match(shim, /#include <native\.h>/);
    assert.match(shim, /vbr_native_value\(void\).*native_value\(\)/s);
    assert.doesNotMatch(shim, /catch/);
    const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.abiPolicy.cStandard, "c11");
    assert.equal(manifest.abiPolicy.panicStrategy, "abort");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("binding schema rejects ambiguous, ambient, and untyped authority", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rust-interop-schema-reject-"));
  try {
    const baseline = {
      schema: "viberoots.rust-interop.v1",
      headers: ["native.hpp"],
      functions: [{ name: "value", return: "i32", params: [] }],
    };
    const cases: Array<[string, object, RegExp]> = [
      ["root-unknown", { ...baseline, surprise: true }, /root contains unknown fields/],
      [
        "function-unknown",
        { ...baseline, functions: [{ ...baseline.functions[0], surprise: true }] },
        /function value contains unknown fields/,
      ],
      [
        "param-unknown",
        {
          ...baseline,
          functions: [
            { name: "value", return: "i32", params: [{ name: "x", type: "i32", extra: 1 }] },
          ],
        },
        /parameter of value contains unknown fields/,
      ],
      [
        "absolute-header",
        { ...baseline, headers: ["/usr/include/native.hpp"] },
        /package-relative/,
      ],
      [
        "undeclared-import",
        {
          ...baseline,
          functions: [
            {
              name: "imported",
              cpp_name: "native",
              direction: "import",
              header: "ambient.hpp",
              return: "i32",
              error_value: -1,
              params: [],
            },
          ],
        },
        /must name one declared header/,
      ],
      [
        "untyped-error",
        {
          ...baseline,
          functions: [
            {
              name: "imported",
              cpp_name: "native",
              direction: "import",
              header: "native.hpp",
              return: "i32",
              error_value: "return -1;",
              params: [],
            },
          ],
        },
        /does not match return type/,
      ],
      [
        "malformed-qualified-cpp-name",
        {
          ...baseline,
          functions: [
            {
              name: "imported",
              cpp_name: "native::::value",
              direction: "import",
              header: "native.hpp",
              return: "i32",
              error_value: -1,
              params: [],
            },
          ],
        },
        /native name .* invalid/,
      ],
      [
        "trailing-qualified-cpp-name",
        {
          ...baseline,
          functions: [
            {
              name: "imported",
              cpp_name: "native::",
              direction: "import",
              header: "native.hpp",
              return: "i32",
              error_value: -1,
              params: [],
            },
          ],
        },
        /native name .* invalid/,
      ],
      [
        "cpp-name-on-export",
        {
          ...baseline,
          functions: [
            {
              name: "exported",
              cpp_name: "native::exported",
              return: "i32",
              params: [],
            },
          ],
        },
        /only valid on imports/,
      ],
      [
        "callback-without-context",
        {
          ...baseline,
          functions: [
            {
              name: "apply",
              return: "i32",
              callback_error_value: -1,
              params: [{ name: "callback", type: "callback_i32" }],
            },
          ],
        },
        /requires exactly callback_i32 then mut_void_ptr/,
      ],
      [
        "callback-return",
        { ...baseline, functions: [{ name: "bad", return: "callback_i32", params: [] }] },
        /cannot be a return type/,
      ],
      [
        "callback-reordered",
        {
          ...baseline,
          functions: [
            {
              name: "apply",
              return: "i32",
              callback_error_value: -1,
              params: [
                { name: "context", type: "mut_void_ptr" },
                { name: "callback", type: "callback_i32" },
              ],
            },
          ],
        },
        /requires exactly callback_i32 then mut_void_ptr/,
      ],
    ];
    for (const [name, value, expected] of cases) {
      const config = path.join(tmp, `${name}.json`);
      await fs.writeFile(config, `${JSON.stringify(value)}\n`);
      const result = await $({ stdio: "pipe" })`
        ${process.execPath} ${generator} ${config} ${path.join(tmp, name)} demo cxx contained abort caller send-sync c++17
      `.nothrow();
      assert.notEqual(result.exitCode, 0, name);
      assert.match(String(result.stderr), expected, name);
    }
    const panic = await $({ stdio: "pipe" })`
      ${process.execPath} ${generator} ${path.join(tmp, "root-unknown.json")} ${path.join(tmp, "panic")} demo cxx contained contained caller send-sync c++17
    `.nothrow();
    assert.match(String(panic.stderr), /panics must abort/);
    const noexceptConfig = path.join(tmp, "noexcept-callback.json");
    await fs.writeFile(
      noexceptConfig,
      `${JSON.stringify({
        ...baseline,
        functions: [
          {
            name: "apply",
            return: "i32",
            params: [
              { name: "callback", type: "callback_i32" },
              { name: "context", type: "mut_void_ptr" },
            ],
          },
        ],
      })}\n`,
    );
    const noexcept = await $({ stdio: "pipe" })`
      ${process.execPath} ${generator} ${noexceptConfig} ${path.join(tmp, "noexcept")} demo cxx noexcept abort caller send-sync c++17
    `.nothrow();
    assert.match(String(noexcept.stderr), /noexcept callback .* unsupported/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
