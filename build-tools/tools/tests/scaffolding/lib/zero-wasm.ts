import * as fsp from "node:fs/promises";
import path from "node:path";

export function toZeroWasmTargets(targetsRaw: string, options: { keepWasmRoots: boolean }): string {
  let next = targetsRaw
    .replace(/node_wasm_inline_module\([\s\S]*?\)\n\n/m, "")
    .replace(/assets\s*=\s*\[[\s\S]*?\],\n/m, "assets = [],\n");
  if (!options.keepWasmRoots) {
    next = next.replace(/\s*wasm_module_roots\s*=\s*\[[^\]]*\],\n/m, "");
  }
  return next;
}

export async function removeDefaultWasmFiles(
  appAbs: string,
  paths: { producerPayloadRel: string; contractRel: string },
): Promise<void> {
  for (const rel of [paths.producerPayloadRel, paths.contractRel]) {
    await fsp.rm(path.join(appAbs, rel), { force: true });
  }
}
