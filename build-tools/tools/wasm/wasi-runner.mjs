import fs from "node:fs/promises";
import { WASI } from "node:wasi";

const modulePath = process.argv[2];
if (!modulePath) {
  console.error("usage: wasi-runner <module.wasm> [args...]");
  process.exit(2);
}

const wasi = new WASI({
  version: "preview1",
  args: [modulePath, ...process.argv.slice(3)],
  env: {},
  preopens: {},
});
const module = await WebAssembly.compile(await fs.readFile(modulePath));
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
});
wasi.start(instance);
