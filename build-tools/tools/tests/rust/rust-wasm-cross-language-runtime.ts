import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

async function instantiateWithRuntimeImports(bytes: Uint8Array): Promise<WebAssembly.Instance> {
  const module = new WebAssembly.Module(bytes);
  const imports: Record<string, Record<string, unknown>> = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ||= {};
    if (entry.kind === "function") imports[entry.module][entry.name] = () => 0;
    else if (entry.kind === "global")
      imports[entry.module][entry.name] = new WebAssembly.Global(
        { value: "i32", mutable: true },
        0,
      );
    else if (entry.kind === "memory")
      imports[entry.module][entry.name] = new WebAssembly.Memory({ initial: 256 });
    else
      imports[entry.module][entry.name] = new WebAssembly.Table({
        initial: 0,
        element: "funcref",
      });
  }
  return await WebAssembly.instantiate(module, imports);
}

export async function executeStaticDependencyConsumer(
  tmp: string,
  current: string,
  tools: string,
  wasi: boolean,
): Promise<number> {
  const built = await buildCanonicalBundle(
    tmp,
    "graph-generator-selected",
    current,
    process.env,
    `//projects/libs/tinygo-rust:${wasi ? "wasm_wasi" : "wasm"}`,
    tools,
    true,
  );
  const instance = await instantiateWithRuntimeImports(
    await fs.readFile(path.join(built.outPath, "lib/top.wasm")),
  );
  return (instance.exports.dependencyAnswer as () => number)();
}

export async function verifyTinyGoConsumer(
  tmp: string,
  current: string,
  tools: string,
): Promise<void> {
  const built = await buildCanonicalBundle(
    tmp,
    "graph-generator-selected",
    current,
    process.env,
    "//projects/libs/tinygo-rust:wasm",
    tools,
    true,
  );
  assert.match(
    await fs.readFile(path.join(built.outPath, "build.log"), "utf8"),
    /rust-wasm:static/,
  );
  const instance = await instantiateWithRuntimeImports(
    await fs.readFile(path.join(built.outPath, "lib/top.wasm")),
  );
  assert.equal((instance.exports.add2and3 as () => number)(), 5);
}

export async function verifyProducerAndCppConsumerDirections(
  tmp: string,
  current: string,
  tools: string,
): Promise<void> {
  for (const name of [
    "raw_tinygo",
    "raw_cpp_tinygo",
    "raw_cpp_rust",
    "raw_cpp_rust_debug",
    "raw_cpp_rust_size",
  ]) {
    const built = await buildCanonicalBundle(
      tmp,
      "graph-generator-selected",
      current,
      process.env,
      `//projects/apps/rust-wasm:${name}`,
      tools,
      true,
    );
    const module = await WebAssembly.instantiate(
      await fs.readFile(path.join(built.outPath, "lib/rust_wasm_fixture.wasm")),
    );
    assert.equal((module.instance.exports.answer as () => number)(), 42);
  }
}

export async function verifyWasiCrossLanguageDirections(
  tmp: string,
  current: string,
  tools: string,
): Promise<void> {
  const tinyGoConsumer = await buildCanonicalBundle(
    tmp,
    "graph-generator-selected",
    current,
    process.env,
    "//projects/libs/tinygo-rust:wasm_wasi",
    tools,
    true,
  );
  const tinyGoInstance = await instantiateWithRuntimeImports(
    await fs.readFile(path.join(tinyGoConsumer.outPath, "lib/top.wasm")),
  );
  assert.equal((tinyGoInstance.exports.add2and3 as () => number)(), 5);
  assert.equal((tinyGoInstance.exports.cppAnswer as () => number)(), 42);

  for (const name of ["raw_wasi_cpp", "raw_wasi_cpp_rust"]) {
    const built = await buildCanonicalBundle(
      tmp,
      "graph-generator-selected",
      current,
      process.env,
      `//projects/apps/rust-wasm:${name}`,
      tools,
      true,
    );
    const instance = await instantiateWithRuntimeImports(
      await fs.readFile(path.join(built.outPath, "lib/rust_wasm_fixture.wasm")),
    );
    assert.equal((instance.exports.answer as () => number)(), 42);
  }
}
