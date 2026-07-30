function importsFor(module) {
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const namespace = (imports[entry.module] ||= {});
    if (entry.kind === "function") namespace[entry.name] = () => 0;
    else if (entry.kind === "memory")
      namespace[entry.name] = new WebAssembly.Memory({ initial: 256, maximum: 256 });
    else if (entry.kind === "table")
      namespace[entry.name] = new WebAssembly.Table({ initial: 0, element: "anyfunc" });
    else if (entry.kind === "global") namespace[entry.name] = 0;
  }
  return imports;
}

async function callWasm(url, names) {
  const module = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  const instance = await WebAssembly.instantiate(module, importsFor(module));
  const name = names.find((candidate) => typeof instance.exports[candidate] === "function");
  if (!name) throw new Error(`missing reviewed export from ${url}`);
  return Number(instance.exports[name]());
}

async function reportCompositionEvidence() {
  const [rustValue, cppValue, goValue] = await Promise.all([
    callWasm("./wasm/rust.wasm", ["rust_wasm_answer"]),
    callWasm("./wasm/cpp.wasm", ["cpp_wasm_answer", "_cpp_wasm_answer"]),
    callWasm("./wasm/go.wasm", ["go_wasm_answer"]),
  ]);
  const evidence = { rustValue, cppValue, goValue };
  document.querySelector("#evidence").textContent = JSON.stringify(evidence);
  document.documentElement.dataset.compositionEvidence = JSON.stringify(evidence);
  await invoke("report_composition_evidence", evidence);
}

void reportCompositionEvidence().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector("#evidence").textContent = `failure: ${message}`;
  await invoke("report_composition_failure", { message });
});
import { invoke } from "@tauri-apps/api/core";
