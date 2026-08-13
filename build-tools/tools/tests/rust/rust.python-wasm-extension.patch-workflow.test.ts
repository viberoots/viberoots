#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exportGraphInTemp, runInTemp, workspaceFlakeRef } from "../lib/test-helpers";
import { writePyO3PyodideApp } from "./rust-pyodide-pyo3-fixture";

const dep = "itoa";
const version = "1.0.15";
const source = "registry+https://github.com/rust-lang/crates.io-index";
const checksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";
const key = `${dep}@${version}#${source}`;

async function vendorAuthority(tmp: string, appDir: string, $: any) {
  const expr = `let f = builtins.getFlake ${JSON.stringify(`path:${path.join(tmp, ".viberoots/workspace")}`)};
pkgs = f.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
in pkgs.rustPlatform.importCargoLock { lockFile = ${JSON.stringify(path.join(appDir, "Cargo.lock"))}; }`;
  const imported = await $({
    cwd: tmp,
    stdio: "pipe",
  })`nix build --impure --no-link --print-out-paths --expr ${expr}`;
  const vendorRoot = String(imported.stdout).trim();
  const entry = (await fs.readdir(vendorRoot)).find((name) => name.startsWith(`${dep}-`));
  assert.ok(entry);
  const storePath = path.join(vendorRoot, entry);
  const hash = await $({ stdio: "pipe" })`nix hash path --type sha256 --sri ${storePath}`;
  return { source, checksum, storePath, narHash: String(hash.stdout).trim() };
}

async function value(outPath: string, $: any): Promise<number> {
  const run = await $({ stdio: "pipe" })`node ${path.join(outPath, "bin", "run.mjs")}`;
  const match = String(run.stdout).match(/RUST_VALUE=(\d+)/);
  assert.ok(match, String(run.stdout));
  return Number(match[1]);
}

async function buildApp(tmp: string, $: any, env: NodeJS.ProcessEnv): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: {
      ...process.env,
      ...env,
      BUCK_TARGET: "//projects/apps/rust_pyodide_app:pyapp",
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      PY_WASM_BACKEND: "pyodide",
    },
  })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode !== 0) throw new Error(`nix build failed:\n${String(res.stderr || "")}`);
  return String(res.stdout).trim().split(/\n+/).pop() || "";
}

test("Rust Pyodide public patch workflow changes and restores imported behavior", async () => {
  await runInTemp("rust-pyodide-patch-workflow", async (tmp, $) => {
    const { appDir } = await writePyO3PyodideApp(tmp);
    await fs.writeFile(
      path.join(appDir, "Cargo.toml"),
      (await fs.readFile(path.join(appDir, "Cargo.toml"), "utf8")) + `itoa = "${version}"\n`,
    );
    await fs.writeFile(
      path.join(appDir, "Cargo.lock"),
      (await fs.readFile(path.join(appDir, "Cargo.lock"), "utf8")).replace(
        '"answer-dep", "pyo3"',
        '"answer-dep", "itoa", "pyo3"',
      ) +
        `\n[[package]]\nname = "${dep}"\nversion = "${version}"\nsource = "${source}"\nchecksum = "${checksum}"\n`,
    );
    await fs.writeFile(
      path.join(appDir, "src/lib.rs"),
      (await fs.readFile(path.join(appDir, "src/lib.rs"), "utf8")).replace(
        "Ok(answer_dep::value())",
        "{ let mut b = itoa::Buffer::new(); Ok(b.format(answer_dep::value()).parse().unwrap()) }",
      ),
    );
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      `
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app")
load("@viberoots//build-tools/rust:defs.bzl", "rust_python_wasm_extension")
rust_python_wasm_extension(
  name = "rust_ext",
  backend = "pyodide",
  module = "demo._native",
  crate = "rust-pyodide-app",
  srcs = ["src/lib.rs"],
  build_py_deps = ["builddep"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
)
nix_python_wasm_app(
  name = "pyapp",
  labels = ["backend:pyodide"],
  lockfile_label = "lockfile:projects/apps/rust_pyodide_app/uv.lock#projects/apps/rust_pyodide_app",
  srcs = glob(["**/*.py"]),
  deps = [":rust_ext"],
)
`,
    );
    const authority = await vendorAuthority(tmp, appDir, $);
    const env = {
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        builddep: {
          version: "1.0.0",
          originPath: "projects/apps/rust_pyodide_app/vendor/builddep",
        },
      }),
      NIX_RUST_DEV_OVERRIDE_JSON: "{}",
      NIX_RUST_TEST_RESOLVE_JSON: JSON.stringify({
        [key]: { ...authority, buildInput: authority },
      }),
    };
    const build = async () => {
      await exportGraphInTemp({ tmp, $ });
      const outPath = await buildApp(tmp, $, env);
      return { outPath, value: await value(outPath, $) };
    };
    const baseline = await build();
    assert.equal(baseline.value, 42);
    const cli = "viberoots/build-tools/tools/bin/patch-pkg";
    await $({
      cwd: tmp,
      env: { ...process.env, ...env, WORKSPACE_ROOT: tmp },
    })`${cli} start rust ${dep} --target //projects/apps/rust_pyodide_app:rust_ext`;
    const sessions = JSON.parse(await fs.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"));
    const workspace = sessions.sessions.rust[key].workspacePath as string;
    await fs.writeFile(
      path.join(workspace, "src/lib.rs"),
      'pub struct Buffer { text: String }\nimpl Buffer { pub fn new() -> Self { Self { text: String::new() } } pub fn format<I>(&mut self, _: I) -> &str { self.text = "43".into(); &self.text } }\n',
    );
    await $({
      cwd: tmp,
      env: { ...process.env, ...env, WORKSPACE_ROOT: tmp },
    })`${cli} apply rust ${dep} --target //projects/apps/rust_pyodide_app:rust_ext`;
    const patched = await build();
    assert.equal(patched.value, 43);
    assert.notEqual(patched.outPath, baseline.outPath);
    await $({
      cwd: tmp,
      env: { ...process.env, ...env, WORKSPACE_ROOT: tmp },
    })`${cli} start rust ${dep} --target //projects/apps/rust_pyodide_app:rust_ext`;
    await $({
      cwd: tmp,
      env: { ...process.env, ...env, WORKSPACE_ROOT: tmp },
    })`${cli} remove rust ${dep} --target //projects/apps/rust_pyodide_app:rust_ext`;
    const restored = await build();
    assert.deepEqual(restored, baseline);
  });
});
