import { defaultTsModuleKey, loadTsModule } from "./ts-modules";
import { defaultWasmModuleKey, readWasmModuleBytes } from "./wasm-contract";

const root = document.getElementById("app");
if (root) {
  root.setAttribute("data-client-hydrated", "true");
  void readWasmModuleBytes(defaultWasmModuleKey()).then((bytes) => {
    root.setAttribute("data-wasm-bytes", String(bytes.byteLength));
  });
  void loadTsModule(defaultTsModuleKey()).then(() => {
    root.setAttribute("data-ts-module", defaultTsModuleKey());
  });
}
