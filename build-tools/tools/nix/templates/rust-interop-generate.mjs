import fs from "node:fs";
import path from "node:path";
import { fail, IDENT, readInteropConfig, TYPES } from "./rust-interop-schema.mjs";

const [
  configPath,
  outputDir,
  publicCrate,
  kind,
  exceptionPolicy = "none",
  panicStrategy = "abort",
  allocator = "caller",
  threadSafety = "send-sync",
  languageStandard = "",
] = process.argv.slice(2);
if (!configPath || !outputDir || !IDENT.test(publicCrate || "")) fail("invalid arguments");
const { config, functions, headers } = readInteropConfig(configPath, {
  kind,
  exceptionPolicy,
  panicStrategy,
  allocator,
  threadSafety,
  languageStandard,
});
const parameter = (value) =>
  value.type === "callback_i32"
    ? `int32_t (*${value.name})(int32_t, void *)`
    : `${TYPES[value.type]} ${value.name}`;
const parameters = (fn) => (fn.params.length ? fn.params.map(parameter).join(", ") : "void");
const RUST_TYPES = {
  void: "()",
  bool: "bool",
  i8: "i8",
  u8: "u8",
  i16: "i16",
  u16: "u16",
  i32: "i32",
  u32: "u32",
  i64: "i64",
  u64: "u64",
  usize: "usize",
  const_char_ptr: "*const core::ffi::c_char",
  mut_char_ptr: "*mut core::ffi::c_char",
  const_void_ptr: "*const core::ffi::c_void",
  mut_void_ptr: "*mut core::ffi::c_void",
  callback_i32: 'extern "C" fn(i32, *mut core::ffi::c_void) -> i32',
};
const rustParameters = (fn) =>
  fn.params.map((param) => `${param.name}: ${RUST_TYPES[param.type]}`).join(", ");
const declaration = (fn) =>
  `${TYPES[fn.return]} ${fn.name}(${parameters(fn)}) VIBEROOTS_RUST_NOEXCEPT;`;
const guard = `VIBEROOTS_RUST_${publicCrate.toUpperCase()}_H`;
const cHeader = [
  `#ifndef ${guard}`,
  `#define ${guard}`,
  "#include <stdbool.h>",
  "#include <stddef.h>",
  "#include <stdint.h>",
  "#ifdef __cplusplus",
  "#define VIBEROOTS_RUST_NOEXCEPT noexcept",
  'extern "C" {',
  "#else",
  "#define VIBEROOTS_RUST_NOEXCEPT",
  "#endif",
  ...functions.map(declaration),
  "#ifdef __cplusplus",
  "}",
  "#endif",
  "#undef VIBEROOTS_RUST_NOEXCEPT",
  `#endif /* ${guard} */`,
  "",
].join("\n");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, `${publicCrate}.h`), cHeader);
const rustImports = functions
  .filter((fn) => fn.direction === "import")
  .map((fn) => `    pub(crate) fn ${fn.name}(${rustParameters(fn)}) -> ${RUST_TYPES[fn.return]};`);
const rustExports = functions
  .filter((fn) => fn.direction === "export")
  .map(
    (fn) =>
      `  const _: unsafe extern "C" fn(${fn.params.map((param) => RUST_TYPES[param.type]).join(", ")}) -> ${RUST_TYPES[fn.return]} = crate::${fn.name};`,
  );
fs.writeFileSync(
  path.join(outputDir, `${publicCrate}.rs`),
  [
    "#[doc(hidden)]",
    "pub(crate) mod __viberoots_abi {",
    ...(rustImports.length ? ['  extern "C" {', ...rustImports, "  }"] : []),
    "}",
    ...rustExports,
    "",
  ].join("\n"),
);
if (kind === "cxx") {
  const namespace = config.namespace || publicCrate;
  if (!IDENT.test(namespace)) fail("namespace must be one C++ identifier");
  const wrappers = functions
    .filter((fn) => fn.direction === "export")
    .map((fn) => {
      const params = parameters(fn);
      const args = fn.params.map((param) => param.name).join(", ");
      const prefix = fn.return === "void" ? "" : "return ";
      const callback = fn.params.find((param) => param.type === "callback_i32");
      const context = fn.params.find((param) => param.type === "mut_void_ptr");
      if (callback && context && exceptionPolicy === "contained") {
        const scope = `${fn.name}_callback_scope`;
        return [
          `struct ${scope} { int32_t (*callback)(int32_t, void *); void *context; };`,
          `inline int32_t ${fn.name}_callback_trampoline(int32_t value, void *opaque) noexcept {`,
          `  auto *scope = static_cast<${scope} *>(opaque);`,
          `  try { return scope->callback(value, scope->context); } catch (...) { return ${fn.callback_error_value}; }`,
          `}`,
          `inline ${TYPES[fn.return]} ${fn.nativeName}(${params}) noexcept {`,
          `  ${scope} scope{${callback.name}, ${context.name}};`,
          `  ${prefix}::${fn.name}(${fn.name}_callback_trampoline, &scope);`,
          `}`,
        ].join("\n");
      }
      return `inline ${TYPES[fn.return]} ${fn.nativeName}(${params}) noexcept { ${prefix}::${fn.name}(${args}); }`;
    });
  fs.writeFileSync(
    path.join(outputDir, `${publicCrate}.hpp`),
    [
      `#pragma once`,
      `#include "${publicCrate}.h"`,
      `namespace ${namespace} {`,
      ...wrappers,
      "}",
      "",
    ].join("\n"),
  );
  const fallback = (fn) => {
    if (fn.return === "void") return "return;";
    if (fn.error_value !== undefined) {
      if (fn.error_value === null) return "return nullptr;";
      return `return ${JSON.stringify(fn.error_value)};`;
    }
    if (fn.return.endsWith("_ptr")) return "return nullptr;";
    return "return {};";
  };
  const imports = functions
    .filter((fn) => fn.direction === "import")
    .map((fn) => {
      const params = parameters(fn);
      const args = fn.params.map((param) => param.name).join(", ");
      const call = `${fn.return === "void" ? "" : "return "}${fn.nativeName}(${args});`;
      const body =
        exceptionPolicy === "contained" ? `try { ${call} } catch (...) { ${fallback(fn)} }` : call;
      return `extern "C" ${TYPES[fn.return]} ${fn.name}(${params}) noexcept { ${body} }`;
    });
  fs.writeFileSync(
    path.join(outputDir, `${publicCrate}.cc`),
    [
      `#include "${publicCrate}.hpp"`,
      ...headers.map((header) => `#include <${header}>`),
      `static_assert(__cplusplus >= 201703L);`,
      ...imports,
      "",
    ].join("\n"),
  );
} else {
  const imports = functions
    .filter((fn) => fn.direction === "import")
    .map((fn) => {
      const params = parameters(fn);
      const args = fn.params.map((param) => param.name).join(", ");
      const call = `${fn.return === "void" ? "" : "return "}${fn.nativeName}(${args});`;
      return `${TYPES[fn.return]} ${fn.name}(${params}) { ${call} }`;
    });
  fs.writeFileSync(
    path.join(outputDir, `${publicCrate}.c`),
    [
      `#include "${publicCrate}.h"`,
      ...headers.map((header) => `#include <${header}>`),
      ...imports,
      "",
    ].join("\n"),
  );
}
fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(
    {
      schema: config.schema,
      generator: "viberoots-rust-bindings-1",
      kind,
      publicCrate,
      abiPolicy: {
        exceptionPolicy,
        panicStrategy,
        allocator,
        threadSafety,
        cxxStandard: kind === "cxx" ? languageStandard : "",
        cStandard: kind === "c" ? languageStandard : "",
      },
      functions,
    },
    null,
    2,
  )}\n`,
);
