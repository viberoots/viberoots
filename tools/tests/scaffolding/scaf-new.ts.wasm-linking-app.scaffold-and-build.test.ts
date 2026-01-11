#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";

async function instantiateWasmFromFile(filePath: string): Promise<WebAssembly.Instance> {
  const bytes = await fs.readFile(filePath);
  const module = new WebAssembly.Module(bytes);
  const imports: Record<string, any> = {};
  const env: Record<string, any> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    if (imp.kind === "function") env[imp.name] = () => 0;
    else if (imp.kind === "global")
      env[imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    else if (imp.kind === "memory") env[imp.name] = new WebAssembly.Memory({ initial: 256 });
    else if (imp.kind === "table")
      env[imp.name] = new WebAssembly.Table({ initial: 0, element: "funcref" });
  }
  if (Object.keys(env).length) imports.env = env;

  try {
    const instance = await WebAssembly.instantiate(module, imports);
    return instance;
  } catch {
    const { WASI } = await import("node:wasi");
    const wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {} });
    const instance = await WebAssembly.instantiate(module, {
      ...imports,
      wasi_snapshot_preview1: wasi.wasiImport,
    } as any);
    if (typeof wasi.start === "function") wasi.start(instance);
    return instance;
  }
}

test("scaf: new ts wasm-linking-app; build tinygo wasm; callAdd2() returns 5", async () => {
  await runInTemp("scaf-ts-wasm-linking-app", async (tmp, $) => {
    const name = "demo";
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node tools/scaffolding/scaf.ts new ts wasm-linking-app ${name} --yes --skip-lockfile-gen`;

    const appTargets = path.join(tmp, "apps", name, "TARGETS");
    const coreTargets = path.join(tmp, "libs", `${name}-core`, "TARGETS");
    const apiTargets = path.join(tmp, "libs", `${name}-api`, "TARGETS");
    const supportTargets = path.join(tmp, "libs", `${name}-support`, "TARGETS");
    await Promise.all([
      fs.access(appTargets),
      fs.access(coreTargets),
      fs.access(apiTargets),
      fs.access(supportTargets),
    ]);

    const appTargetsText = await fs.readFile(appTargets, "utf8");
    assert.ok(
      appTargetsText.includes(`lockfile:apps/${name}/pnpm-lock.yaml#apps/${name}`),
      "expected importer-scoped pnpm lockfile label in apps/<name>/TARGETS",
    );

    const coreTargetsText = await fs.readFile(coreTargets, "utf8");
    assert.ok(coreTargetsText.includes("header_deps"), "expected core_wasm to declare header_deps");
    assert.ok(coreTargetsText.includes("link_deps"), "expected core_wasm to declare link_deps");

    const apiTargetsText = await fs.readFile(apiTargets, "utf8");
    assert.ok(
      apiTargetsText.includes("link_deps"),
      "expected tinygo wasm target to declare link_deps",
    );
    assert.ok(
      apiTargetsText.includes('link_closure = "transitive"'),
      'expected tinygo wasm target to set link_closure = "transitive"',
    );

    await $({
      cwd: tmp,
      stdio: "inherit",
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- tools/buck/export-graph.ts --out tools/buck/graph.json`;

    const wasmTarget = `//libs/${name}-api:wasm`;
    const sel = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_TARGET: wasmTarget, WEB_WASM_BACKEND: "wasi_single" },
    })`nix run --accept-flake-config ${`path:${tmp}#zx-wrapper`} -- tools/dev/build-selected.ts`;
    const outPath =
      String(sel.stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) throw new Error("no out path emitted by build-selected.ts");

    const wasmPath = path.join(outPath, "lib", "top.wasm");
    await fs.access(wasmPath);
    const inst = await instantiateWasmFromFile(wasmPath);
    const exp = inst.exports as any;
    const got = exp.callAdd2();
    assert.equal(got, 5);
  });
});
