import fs from "node:fs";

export const TYPES = {
  void: "void",
  bool: "bool",
  i8: "int8_t",
  u8: "uint8_t",
  i16: "int16_t",
  u16: "uint16_t",
  i32: "int32_t",
  u32: "uint32_t",
  i64: "int64_t",
  u64: "uint64_t",
  usize: "size_t",
  const_char_ptr: "const char *",
  mut_char_ptr: "char *",
  const_void_ptr: "const void *",
  mut_void_ptr: "void *",
  callback_i32: "int32_t (*)(int32_t, void *)",
};
export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CPP_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/;
const HEADER = /^[A-Za-z0-9_./-]+\.(?:h|hh|hpp|hxx)$/;
const ROOT_KEYS = new Set(["schema", "namespace", "headers", "functions"]);
const FUNCTION_KEYS = new Set([
  "name",
  "native_name",
  "cpp_name",
  "direction",
  "return",
  "error_value",
  "callback_error_value",
  "header",
  "ownership",
  "params",
]);
const PARAM_KEYS = new Set(["name", "type"]);
export const fail = (message) => {
  throw new Error(`Rust interop binding config: ${message}`);
};
const rejectUnknown = (value, allowed, context) => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${context} contains unknown fields: ${unknown.sort().join(", ")}`);
};

export function readInteropConfig(configPath, policy) {
  const { kind, exceptionPolicy, panicStrategy, allocator, threadSafety, languageStandard } =
    policy;
  if (!["c", "cxx"].includes(kind)) fail(`unsupported interop kind ${kind}`);
  if (!["none", "noexcept", "contained"].includes(exceptionPolicy))
    fail("invalid exception policy");
  if (panicStrategy !== "abort") fail("cross-language Rust panics must abort");
  if (!["caller", "rust"].includes(allocator)) fail("invalid allocator policy");
  if (threadSafety !== "send-sync") fail("single-threaded bridge enforcement is unsupported");
  if (kind === "c" && exceptionPolicy !== "none") fail("C bindings require exception policy none");
  if (kind === "cxx" && (exceptionPolicy === "none" || languageStandard !== "c++17")) {
    fail("C++ bindings require an exception policy and pinned c++17 standard");
  }
  if (kind === "c" && languageStandard !== "c11") fail("C bindings require pinned c11 standard");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config || Array.isArray(config) || typeof config !== "object")
    fail("root must be an object");
  rejectUnknown(config, ROOT_KEYS, "root");
  if (config.schema !== "viberoots.rust-interop.v1")
    fail("schema must be viberoots.rust-interop.v1");
  if (
    config.namespace !== undefined &&
    (kind !== "cxx" || typeof config.namespace !== "string" || !IDENT.test(config.namespace))
  ) {
    fail("namespace is an optional C++ identifier");
  }
  if (!Array.isArray(config.functions) || config.functions.length === 0) {
    fail("functions must be a non-empty array");
  }
  const headers = config.headers || [];
  if (
    !Array.isArray(headers) ||
    headers.some(
      (header) =>
        !HEADER.test(header) ||
        header.includes("..") ||
        header.startsWith("/") ||
        /^[A-Za-z]:/.test(header),
    )
  ) {
    fail("headers must be normalized package-relative C/C++ header paths");
  }
  if (new Set(headers).size !== headers.length) fail("headers must not contain duplicates");
  const names = new Set();
  const functions = config.functions.map((fn) => {
    if (!fn || Array.isArray(fn) || typeof fn !== "object") fail("functions must be objects");
    rejectUnknown(fn, FUNCTION_KEYS, `function ${fn.name || "<unnamed>"}`);
    if (!IDENT.test(fn.name || "")) fail("function names must be C identifiers");
    if (names.has(fn.name)) fail(`duplicate function ${fn.name}`);
    names.add(fn.name);
    if (!(fn.return in TYPES)) fail(`unsupported return type for ${fn.name}`);
    if (fn.return === "callback_i32") fail(`callback_i32 cannot be a return type for ${fn.name}`);
    const params = fn.params || [];
    if (!Array.isArray(params)) fail(`params for ${fn.name} must be an array`);
    const paramNames = new Set();
    for (const param of params) {
      if (!param || Array.isArray(param) || typeof param !== "object") {
        fail(`params for ${fn.name} must be objects`);
      }
      rejectUnknown(param, PARAM_KEYS, `parameter of ${fn.name}`);
      if (!IDENT.test(param.name || "")) fail(`invalid parameter name for ${fn.name}`);
      if (paramNames.has(param.name)) fail(`duplicate parameter ${param.name} for ${fn.name}`);
      paramNames.add(param.name);
      if (!(param.type in TYPES) || param.type === "void") {
        fail(`unsupported parameter type for ${fn.name}`);
      }
    }
    const direction = fn.direction || "export";
    if (!["export", "import"].includes(direction)) fail(`invalid direction for ${fn.name}`);
    if (kind === "cxx" && direction === "export" && fn.cpp_name !== undefined) {
      fail(`cpp_name for ${fn.name} is only valid on imports`);
    }
    const nativeName = kind === "cxx" ? fn.cpp_name || fn.name : fn.native_name || fn.name;
    if (kind === "cxx" && fn.native_name !== undefined)
      fail(`native_name is C-only for ${fn.name}`);
    if (kind === "c" && fn.cpp_name !== undefined) fail(`cpp_name is C++-only for ${fn.name}`);
    if (!(kind === "cxx" ? CPP_NAME : IDENT).test(nativeName))
      fail(`native name for ${fn.name} is invalid`);
    if (direction === "import" && (!fn.header || !headers.includes(fn.header))) {
      fail(`import ${fn.name} must name one declared header`);
    }
    if (fn.header !== undefined && !headers.includes(fn.header)) {
      fail(`header for ${fn.name} is not declared`);
    }
    if (direction === "export" && fn.header !== undefined) {
      fail(`export ${fn.name} cannot claim an import header`);
    }
    if (
      direction === "import" &&
      exceptionPolicy === "contained" &&
      fn.return !== "void" &&
      fn.error_value === undefined
    ) {
      fail(`contained import ${fn.name} requires error_value`);
    }
    if (fn.error_value !== undefined) {
      if (direction !== "import" || exceptionPolicy !== "contained") {
        fail(`error_value for ${fn.name} is only valid on contained imports`);
      }
      const valid =
        (fn.return === "bool" && typeof fn.error_value === "boolean") ||
        (fn.return.endsWith("_ptr") && fn.error_value === null) ||
        (!["void", "bool"].includes(fn.return) &&
          !fn.return.endsWith("_ptr") &&
          Number.isSafeInteger(fn.error_value));
      if (!valid) fail(`error_value for ${fn.name} does not match return type ${fn.return}`);
    }
    const callbacks = params.filter((param) => param.type === "callback_i32");
    const hasCallback = callbacks.length !== 0;
    if (callbacks.length > 1) fail(`function ${fn.name} supports one callback`);
    if (
      hasCallback &&
      (params.length !== 2 ||
        params[0].type !== "callback_i32" ||
        params[1].type !== "mut_void_ptr")
    ) {
      fail(`callback ${fn.name} requires exactly callback_i32 then mut_void_ptr`);
    }
    if (kind === "cxx" && direction === "export" && hasCallback && exceptionPolicy === "noexcept") {
      fail(`C++ noexcept callback ${fn.name} is unsupported; use contained`);
    }
    if (fn.callback_error_value !== undefined && !Number.isSafeInteger(fn.callback_error_value)) {
      fail(`callback_error_value for ${fn.name} must be an integer`);
    }
    if (
      fn.callback_error_value !== undefined &&
      !(kind === "cxx" && direction === "export" && hasCallback && exceptionPolicy === "contained")
    ) {
      fail(`callback_error_value for ${fn.name} is only valid on contained C++ exports`);
    }
    if (
      kind === "cxx" &&
      direction === "export" &&
      hasCallback &&
      exceptionPolicy === "contained" &&
      fn.callback_error_value === undefined
    ) {
      fail(`contained callback ${fn.name} requires callback_error_value`);
    }
    if (fn.ownership !== undefined && !["rust", "destructor"].includes(fn.ownership)) {
      fail(`invalid ownership for ${fn.name}`);
    }
    if (fn.ownership !== undefined && direction !== "export") {
      fail(`ownership for ${fn.name} is only valid on exports`);
    }
    if (fn.ownership === "rust" && fn.return !== "mut_void_ptr") {
      fail(`Rust-owned function ${fn.name} must return mut_void_ptr`);
    }
    if (
      fn.ownership === "destructor" &&
      (fn.return !== "void" || params.length !== 1 || params[0].type !== "mut_void_ptr")
    ) {
      fail(`destructor ${fn.name} must be void(mut_void_ptr)`);
    }
    return { ...fn, nativeName, direction, params };
  });
  functions.sort((left, right) => left.name.localeCompare(right.name));
  if (allocator === "rust") {
    if (!functions.some((fn) => fn.ownership === "rust"))
      fail("Rust allocator requires owned values");
    if (!functions.some((fn) => fn.ownership === "destructor")) {
      fail("Rust allocator requires a reviewed destructor");
    }
  } else if (functions.some((fn) => fn.ownership !== undefined)) {
    fail("caller allocator forbids Rust ownership annotations");
  }
  return { config, functions, headers };
}
