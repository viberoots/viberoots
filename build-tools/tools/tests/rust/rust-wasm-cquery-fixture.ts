import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";

export const wasmDeclarations = [
  'rust_wasm_static_library(name = "wasm_static", crate = "rustapp", wasm_header = "rustapp.h", srcs = ["src/lib.rs"])',
  'rust_wasm_browser_package(name = "browser", crate = "rustapp", exported_functions = ["add"], wasm_optimize = "size", wasm_debug = True, wasm_source_map = True, srcs = ["src/lib.rs"])',
  'rust_wasm_component(name = "component", crate = "rustapp", wit = "wit/math.wit", wit_world = "calculator", exported_functions = ["add"], srcs = ["src/lib.rs"])',
];

export async function writeWasmContractFiles(appDir: string): Promise<void> {
  await fs.writeFile(path.join(appDir, "rustapp.h"), "int add(int a, int b);\n", "utf8");
  await fs.mkdirp(path.join(appDir, "wit"));
  await fs.writeFile(
    path.join(appDir, "wit", "math.wit"),
    "package test:math;\nworld calculator { export add: func(a: s32, b: s32) -> s32; }\n",
    "utf8",
  );
}

export async function assertWasmCqueryContract(tmp: string, command: any): Promise<void> {
  const fields =
    await command`buck2 cquery --target-platforms //:no_cgo --json --output-attribute wasm_abi --output-attribute wasm_target --output-attribute wasm_link_kind --output-attribute wasm_runtime --output-attribute wasm_header --output-attribute exported_functions --output-attribute wasm_optimize --output-attribute wasm_debug --output-attribute wasm_source_map --output-attribute wit --output-attribute wit_world --output-attribute component_adapter --output-attribute module_surface --output-attribute out "set(//projects/apps/rustapp:wasm_static //projects/apps/rustapp:browser //projects/apps/rustapp:component)"`;
  const contract = String(fields.stdout);
  for (const expected of [
    "wasm32-unknown-unknown",
    "rustapp.h",
    "browser.browser",
    "wit/math.wit",
    "calculator",
    "wasm:v2:bare:browser",
    "size",
  ]) {
    assert.ok(contract.includes(expected), `missing Rust WASM field ${expected}`);
  }
  const surfaces = await command({
    cwd: tmp,
    stdio: "pipe",
  })`buck2 cquery --target-platforms //:no_cgo "set(//projects/apps/rustapp:wasm_static__surface //projects/apps/rustapp:browser__surface //projects/apps/rustapp:component__surface)"`;
  assert.match(String(surfaces.stdout), /browser__surface/);
}

export async function assertRustNixRuleKinds(command: any): Promise<void> {
  const test =
    await command`buck2 cquery --target-platforms //:no_cgo "kind(rust_nix_test, //projects/apps/rustapp:test)"`;
  assert.match(String(test.stdout || ""), /rustapp:test/);
  for (const name of ["raw", "wasi", "wasm_static", "browser", "component", "pyext", "addon"]) {
    const result =
      await command`buck2 cquery --target-platforms //:no_cgo "kind(rust_nix_build, //projects/apps/rustapp:${name})"`;
    assert.match(String(result.stdout || ""), new RegExp(`rustapp:${name}`));
  }
}
