#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function buckOutPath(args: {
  tmp: string;
  $: any;
  target: string;
  env?: Record<string, string>;
}): Promise<string> {
  const { tmp, $, target, env } = args;
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    env: { ...process.env, ...(env || {}) },
  })`buck2 build --target-platforms prelude//platforms:default --show-output ${target}`;
  const outText = String(res.stdout || res.stderr || "").trim();
  const outLine = outText.split(/\n+/).pop() || "";
  const outPath = outLine.split(/\s+/).pop() || "";
  if (!outPath) throw new Error(`no output for ${target}`);
  return path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
}

async function instantiateWasmFromFile(filePath: string): Promise<WebAssembly.Instance> {
  const bytes = await fs.readFile(filePath);
  const module = new WebAssembly.Module(bytes);
  const imports: Record<string, any> = {};
  const env: Record<string, any> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== "env") continue;
    if (imp.kind === "function") env[imp.name] = () => 0;
    else if (imp.kind === "global") {
      const type = (imp as any).type;
      const rawValue = type?.value;
      const value =
        rawValue === "i64" || rawValue === "f32" || rawValue === "f64" ? rawValue : "i32";
      const inferredMutable = imp.name === "__stack_pointer";
      const mutable = typeof type?.mutable === "boolean" ? type.mutable : inferredMutable;
      env[imp.name] = new WebAssembly.Global({ value, mutable }, 0);
    } else if (imp.kind === "memory") env[imp.name] = new WebAssembly.Memory({ initial: 256 });
    else if (imp.kind === "table") {
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
    })`node build-tools/tools/scaffolding/scaf.ts new ts wasm-linking-app ${name} --yes`;

    const appTargets = path.join(tmp, "projects", "apps", name, "TARGETS");
    const cliTargets = path.join(tmp, "projects", "apps", `${name}-cli`, "TARGETS");
    const coreTargets = path.join(tmp, "projects", "libs", `${name}-core`, "TARGETS");
    const apiTargets = path.join(tmp, "projects", "libs", `${name}-api`, "TARGETS");
    const supportTargets = path.join(tmp, "projects", "libs", `${name}-support`, "TARGETS");
    const inlineTargets = path.join(tmp, "projects", "libs", `${name}-wasm-inline`, "TARGETS");
    await Promise.all([
      fs.access(appTargets),
      fs.access(cliTargets),
      fs.access(coreTargets),
      fs.access(apiTargets),
      fs.access(supportTargets),
      fs.access(inlineTargets),
    ]);

    const appTargetsText = await fs.readFile(appTargets, "utf8");
    assert.ok(
      !appTargetsText.includes("lockfile:"),
      "expected projects/apps/<name>/TARGETS to rely on default lockfile labels",
    );
    assert.ok(
      appTargetsText.includes("node_asset_stage"),
      "expected wasm-linking-app webapp to use node_asset_stage",
    );
    assert.ok(
      appTargetsText.includes("webapp_raw"),
      "expected wasm-linking-app webapp to include a raw node_webapp target",
    );
    assert.ok(
      appTargetsText.includes("wasm-inline/index.js"),
      "expected wasm-linking-app webapp to stage wasm-inline/index.js",
    );

    const inlineTargetsText = await fs.readFile(inlineTargets, "utf8");
    assert.ok(
      inlineTargetsText.includes("node_wasm_inline_module"),
      "expected wasm-inline package to use node_wasm_inline_module",
    );

    const coreTargetsText = await fs.readFile(coreTargets, "utf8");
    assert.ok(coreTargetsText.includes("header_deps"), "expected core_wasm to declare header_deps");
    assert.ok(coreTargetsText.includes("link_deps"), "expected core_wasm to declare link_deps");
    const cppWasmTargetsText = await fs.readFile(
      path.join(tmp, "projects", "libs", `${name}-cpp-wasm`, "TARGETS"),
      "utf8",
    );
    assert.ok(
      cppWasmTargetsText.includes('name = "app"'),
      'expected cpp wasm library package to include an "app" target for package selection',
    );
    assert.ok(
      cppWasmTargetsText.includes('labels = ["lang:cpp", "kind:wasm"]'),
      "expected cpp wasm library target to include kind labels",
    );

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
    })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;

    const webappOut = await buckOutPath({
      tmp,
      $,
      target: `//projects/apps/${name}:webapp`,
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    const cppWasmOut = await buckOutPath({
      tmp,
      $,
      target: `//projects/libs/${name}-cpp-wasm:app`,
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    await fs.access(cppWasmOut);
    const wasmPath = path.join(webappOut, "top.wasm");
    await fs.access(wasmPath);
    const inst = await instantiateWasmFromFile(wasmPath);
    const exp = inst.exports as any;
    const got = exp.callAdd2();
    assert.equal(got, 5);
    await fs.access(path.join(webappOut, "wasm-inline", "index.js"));
    await fs.access(path.join(webappOut, "wasm-inline", "cpp.js"));
    await fs.access(path.join(webappOut, "wasm-inline", "py.js"));

    const inlinePkgDir = path.join(tmp, "projects", "libs", `${name}-wasm-inline`);
    await fs.copy(
      path.join(webappOut, "wasm-inline", "index.js"),
      path.join(inlinePkgDir, "index.js"),
    );
    await fs.copy(path.join(webappOut, "wasm-inline", "cpp.js"), path.join(inlinePkgDir, "cpp.js"));
    await fs.copy(path.join(webappOut, "wasm-inline", "py.js"), path.join(inlinePkgDir, "py.js"));

    const cliOut = await buckOutPath({
      tmp,
      $,
      target: `//projects/apps/${name}-cli:${name}_cli`,
      env: { WEB_WASM_BACKEND: "wasi_single" },
    });
    const runDir = path.join(tmp, "tmp-cli-run");
    await fs.mkdirp(runDir);
    const runBin = path.join(runDir, `${name}-cli`);
    await fs.copyFile(cliOut, runBin);
    await fs.chmod(runBin, 0o755);
    const run = await $({ cwd: runDir, stdio: "pipe" })`${runBin}`;
    const stdout = String(run.stdout || "");
    assert.match(stdout, /go_callAdd2=5/);
    assert.match(stdout, /cpp_add=5/);
    assert.match(stdout, /pyext_exports=/);
  });
});
