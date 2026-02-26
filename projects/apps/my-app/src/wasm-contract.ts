export async function readWasmContractBytes(): Promise<Uint8Array> {
  const wasmUrl = new URL("/top.wasm", window.location.href).toString();
  const res = await fetch(wasmUrl);
  if (!res.ok) {
    throw new Error(`failed to load wasm contract asset: ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const inlineUrl = new URL("/wasm-inline/index.js", window.location.href).toString();
  const inlineRes = await fetch(inlineUrl);
  if (!inlineRes.ok) {
    throw new Error(`failed to load inline wasm module: ${inlineRes.status}`);
  }
  const inlineText = await inlineRes.text();
  if (!inlineText.includes("wasmBytesBase64")) {
    throw new Error("inline wasm contract module shape mismatch");
  }
  return bytes;
}
