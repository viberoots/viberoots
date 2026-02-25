#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("backend toggle tinygo_single and emscripten_dual both return add(2,3)=5", async () => {
  await runInTemp("backend-toggle", async (tmp, $) => {
    // 1) Scaffold minimal C wrapper and header (pure compute) in a temp repo
    const coreDir = path.join(tmp, "projects", "libs", "math-core");
    await fsp.mkdir(path.join(coreDir, "include"), { recursive: true });
    await fsp.mkdir(path.join(coreDir, "src", "cwrapper"), { recursive: true });
    await fsp.writeFile(
      path.join(coreDir, "include", "addon.h"),
      `#ifndef MATH_CORE_ADDON_H
#define MATH_CORE_ADDON_H
#ifdef __cplusplus
extern "C" {
#endif
int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
`,
    );
    await fsp.writeFile(
      path.join(coreDir, "src", "cwrapper", "addon.c"),
      `#include "../../include/addon.h"
int add(int a, int b) { return a + b; }
`,
    );
    await fsp.writeFile(
      path.join(coreDir, "TARGETS"),
      `load("//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib", "nix_cpp_wasm_emscripten_lib")

nix_cpp_wasm_static_lib(
    name = "core_wasm",
    srcs = ["src/cwrapper/addon.c"],
    headers = ["include/addon.h"],
    labels = ["lang:cpp", "kind:lib"],
    visibility = ["PUBLIC"],
)

nix_cpp_wasm_emscripten_lib(
    name = "core_emscripten",
    # Planner stub; no srcs needed here. The planner will read from package layout.
    exported_functions = ["_add"],
    labels = ["lang:cpp", "kind:lib", "wasm:emscripten"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 2) TinyGo package exporting a wasm function `add`
    const apiDir = path.join(tmp, "projects", "libs", "math-api");
    await fsp.mkdir(apiDir, { recursive: true });
    await fsp.writeFile(
      path.join(apiDir, "go.mod"),
      `module example.com/math/api

go 1.22.0
`,
    );
    await fsp.writeFile(
      path.join(apiDir, "main.go"),
      `package main

//export add
func add(a int32, b int32) int32 {
  return a + b
}

func main() {}
`,
    );
    await fsp.writeFile(
      path.join(apiDir, "TARGETS"),
      `load("//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm",
    srcs = ["main.go"],
    deps = ["//projects/libs/math-core:core_wasm"],
    labels = ["lang:go", "kind:wasm"],
    visibility = ["PUBLIC"],
)
`,
    );

    // 3) Provide C++ defs in the temp repo (planner-visible)
    await fsp.writeFile(
      path.join(tmp, "build-tools", "cpp", "defs.bzl"),
      await fsp.readFile("build-tools/cpp/defs.bzl", "utf8"),
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "cpp", "wasm_defs.bzl"),
      await fsp.readFile("build-tools/cpp/wasm_defs.bzl", "utf8"),
    );

    // 4) Export graph once
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    // 5) Build TinyGo wasm via selected-wasm
    const { stdout: outWasmSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//projects/libs/math-api:wasm" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected-wasm`} --accept-flake-config --no-link --print-out-paths`;
    const outWasmPath =
      String(outWasmSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outWasmPath) throw new Error("no out path from graph-generator-selected-wasm");
    const tinygoWasm = path.join(outWasmPath, "lib", "top.wasm");
    {
      const ok =
        await $`bash --noprofile --norc -c ${`test -f ${tinygoWasm} && echo ok || true`}`.nothrow();
      if (
        !String(ok.stdout || "")
          .trim()
          .includes("ok")
      ) {
        throw new Error("expected lib/top.wasm under selected-wasm out path");
      }
    }

    // 6) Build Emscripten C++ bundle via selected (planner routes wasm:emscripten)
    const { stdout: outEmsSel } = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/libs/math-core:core_emscripten",
        PLANNER_ONLY_CPP: "1",
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- build-tools/tools/dev/build-selected.ts`;
    const outEmsPath =
      String(outEmsSel || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outEmsPath) throw new Error("no out path from build-selected for emscripten bundle");
    // Probe artifact names (lib/<sanitized>.js/.wasm)
    const libDir = path.join(outEmsPath, "lib");
    const files = await fsp.readdir(libDir);
    const jsFile = files.find((f) => f.endsWith(".js")) || "";
    const wasmFile = files.find((f) => f.endsWith(".wasm")) || "";
    if (!jsFile || !wasmFile) {
      throw new Error(`expected emscripten outputs under ${libDir}`);
    }
    const emJs = path.join(libDir, jsFile);
    const emWasm = path.join(libDir, wasmFile);

    // 7) Minimal TS/ESM loader that reads a manifest and returns the API
    const tsDir = path.join(tmp, "projects", "libs", "math-ts", "src", "browser");
    await fsp.mkdir(tsDir, { recursive: true });
    const loaderPath = path.join(tsDir, "index.mjs");
    await fsp.writeFile(
      loaderPath,
      `
import { readFile } from 'node:fs/promises';

export async function loadFromManifest(manifestPath) {
  const raw = manifestPath.startsWith("file://")
    ? await readFile(new URL(manifestPath), 'utf8')
    : await readFile(manifestPath, 'utf8');
  const m = JSON.parse(raw);
  if (m.backend === "tinygo_single") {
    const url = m.tinygoWasm;
    if (url.startsWith("file://")) {
      const bytes = await readFile(new URL(url));
      let instance;
      try {
        ({ instance } = await WebAssembly.instantiate(bytes, {}));
      } catch (e) {
        // WASI fallback for environments that emit WASI modules
        const { WASI } = await import('node:wasi');
        const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
        ({ instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport }));
        if (typeof wasi.start === 'function') wasi.start(instance);
      }
      const exp = instance.exports;
      return { add: (a, b) => exp.add(a, b) };
    }
    const res = await fetch(url);
    let inst;
    try {
      ({ instance: inst } = await WebAssembly.instantiateStreaming(res, {}));
    } catch {
      const buf = await (await fetch(url)).arrayBuffer();
      ({ instance: inst } = await WebAssembly.instantiate(buf, {}));
    }
    const exp = inst.exports;
    return { add: (a, b) => exp.add(a, b) };
  }
  if (m.backend === "emscripten_dual") {
    const jsUrl = m.emscripten.js;
    const wasmUrl = m.emscripten.wasm;
    const mod = await import(jsUrl);
    const factory = mod && (mod.default || mod.ModuleFactory || mod);
    if (typeof factory !== "function") {
      throw new Error("invalid emscripten module: no default factory function");
    }
    const Module = await factory({
      locateFile: (p) => {
        if (p.endsWith(".wasm")) return new URL(wasmUrl).pathname;
        return p;
      },
    });
    let add = Module._add || Module.add || null;
    if (!add && Module && Module.asm && Module.asm.exports && typeof Module.asm.exports.add === "function") {
      add = (a, b) => Module.asm.exports.add(a, b);
    }
    if (!add && Module.cwrap) {
      add = Module.cwrap('add', 'number', ['number', 'number']);
    }
    if (!add) throw new Error("emscripten add() not found");
    // Optionally instantiate TinyGo wasm if present (not required for this routing)
    if (m.tinygoWasm) {
      try {
        const url = m.tinygoWasm;
        const bytes = await readFile(new URL(url));
        await WebAssembly.instantiate(bytes, {});
      } catch {}
    }
    return { add: (a, b) => add(a, b) };
  }
  throw new Error("unknown backend: " + m.backend);
}
`,
      "utf8",
    );

    // 8) Manifests for both backends
    const manifestsDir = path.join(tmp, "projects", "libs", "math-ts", "dist");
    await fsp.mkdir(manifestsDir, { recursive: true });
    const tinyManifest = path.join(manifestsDir, "manifest.tiny.json");
    const emManifest = path.join(manifestsDir, "manifest.ems.json");
    await fsp.writeFile(
      tinyManifest,
      JSON.stringify(
        {
          backend: "tinygo_single",
          tinygoWasm: "file://" + tinygoWasm,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(
      emManifest,
      JSON.stringify(
        {
          backend: "emscripten_dual",
          tinygoWasm: "file://" + tinygoWasm,
          emscripten: {
            js: "file://" + emJs,
            wasm: "file://" + emWasm,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // 9) Import loader and verify both backends
    const fileUrl = "file://" + loaderPath;
    const mod = await import(fileUrl);
    const tinyApi = await mod.loadFromManifest("file://" + tinyManifest);
    const tinyGot = tinyApi.add(2, 3);
    if (tinyGot !== 5) throw new Error(`tinygo_single expected 5, got ${tinyGot}`);

    const emApi = await mod.loadFromManifest("file://" + emManifest);
    const emGot = emApi.add(2, 3);
    if (emGot !== 5) throw new Error(`emscripten_dual expected 5, got ${emGot}`);
  });
});
