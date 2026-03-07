import { defaultWasmModuleKey, readWasmContractBytes } from "./wasm-contract";

function buildWasmImports(module: WebAssembly.Module): WebAssembly.Imports {
  const imports: WebAssembly.Imports = {};
  const env: WebAssembly.ModuleImports = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    if (imp.kind === "function") {
      env[imp.name] = () => 0;
      continue;
    }
    if (imp.kind === "global") {
      const type = (imp as any).type;
      const rawValue = type?.value;
      const value =
        rawValue === "i64" || rawValue === "f32" || rawValue === "f64" ? rawValue : "i32";
      const mutable =
        typeof type?.mutable === "boolean" ? type.mutable : imp.name === "__stack_pointer";
      env[imp.name] = new WebAssembly.Global({ value, mutable }, 0);
      continue;
    }
    if (imp.kind === "memory") {
      env[imp.name] = new WebAssembly.Memory({ initial: 256 });
      continue;
    }
    if (imp.kind === "table") {
      const type = (imp as any).type;
      const rawElement = type?.element;
      const element = rawElement === "externref" ? "externref" : "anyfunc";
      const initial =
        typeof type?.minimum === "number"
          ? type.minimum
          : typeof type?.initial === "number"
            ? type.initial
            : 1;
      const desc: WebAssembly.TableDescriptor = { initial, element };
      if (typeof type?.maximum === "number") desc.maximum = type.maximum;
      env[imp.name] = new WebAssembly.Table(desc);
    }
  }
  if (Object.keys(env).length > 0) imports.env = env;
  return imports;
}

export async function resolveSubtitleFromCppWasm(): Promise<string> {
  try {
    if (!defaultWasmModuleKey()) throw new Error("wasm module key missing");
    const bytes = await readWasmContractBytes();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
      throw new Error("wasm bytes unavailable");
    const module = new WebAssembly.Module(bytes as BufferSource);
    const imports = buildWasmImports(module);
    const instance = await WebAssembly.instantiate(module, imports);
    const exp = instance.exports as Record<string, unknown>;
    const fn =
      typeof exp._subtitle_code === "function"
        ? (exp._subtitle_code as () => number)
        : typeof exp.subtitle_code === "function"
          ? (exp.subtitle_code as () => number)
          : null;
    if (!fn) throw new Error("subtitle function export missing");
    const code = Number(fn());
    if (code === 7) return "Subtitle from C++ Wasm library.";
    return `Subtitle code from C++ Wasm: ${String(code)}.`;
  } catch (error) {
    console.error("[example-webapp] subtitle-from-cpp-wasm failed", error);
    return "Subtitle unavailable. Verify C++ Wasm build output.";
  }
}
