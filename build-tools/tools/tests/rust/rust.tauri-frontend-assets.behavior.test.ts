#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { makeTauriCompositionConsumer } from "./rust.tauri-consumer-fixture";

process.env.TEST_NEED_DEV_ENV = "1";
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const target = "//projects/apps/tauri-composition-app:frontend";

async function findFile(root: string, basename: string, marker: string): Promise<string> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name === basename && file.includes(marker)) return file;
    }
  }
  throw new Error(`missing ${basename} under ${root}`);
}

function importsFor(module: WebAssembly.Module): WebAssembly.Imports {
  const imports: WebAssembly.Imports = {};
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

async function callWasm(file: string, names: string[]): Promise<number> {
  const module = await WebAssembly.compile(await fsp.readFile(file));
  const instance = await WebAssembly.instantiate(module, importsFor(module));
  const name = names.find((candidate) => typeof instance.exports[candidate] === "function");
  assert.ok(name, `missing reviewed export from ${file}`);
  return Number((instance.exports[name] as CallableFunction)());
}

async function assertWasmSurface(file: string, producer: "Rust" | "C++" | "TinyGo") {
  assert.deepEqual(
    [...(await fsp.readFile(file)).subarray(0, 4)],
    [0x00, 0x61, 0x73, 0x6d],
    `${producer} surface did not resolve to a WebAssembly binary: ${file}`,
  );
}

test(
  "canonical Node frontend stages every declared mixed-producer WASM asset",
  { timeout: 1_800_000 },
  async () => {
    await runInScratchTemp("tauri-frontend-assets", async (tmp, $) => {
      const fixture = await makeTauriCompositionConsumer(tmp, sourceRoot, $);
      try {
        await $({
          cwd: fixture.consumer,
          env: fixture.artifactEnv(),
          stdio: "inherit",
        })`b ${target}`;
        const compositionScript = await findFile(
          path.join(fixture.consumer, "buck-out"),
          "composition.js",
          `${path.sep}__frontend__${path.sep}`,
        );
        const dist = path.dirname(compositionScript);
        const rust = path.join(dist, "wasm", "rust.wasm");
        const cpp = path.join(dist, "wasm", "cpp.wasm");
        const go = path.join(dist, "wasm", "go.wasm");
        await Promise.all([fsp.access(rust), fsp.access(cpp), fsp.access(go)]);
        await Promise.all([
          assertWasmSurface(rust, "Rust"),
          assertWasmSurface(cpp, "C++"),
          assertWasmSurface(go, "TinyGo"),
        ]);
        assert.deepEqual(
          await Promise.all([
            callWasm(rust, ["rust_wasm_answer"]),
            callWasm(cpp, ["cpp_wasm_answer", "_cpp_wasm_answer"]),
            callWasm(go, ["go_wasm_answer"]),
          ]),
          [42, 42, 42],
        );
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
