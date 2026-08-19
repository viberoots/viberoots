#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { runInTemp } from "../lib/test-helpers";

const load = [
  'load("@prelude//:rules.bzl", "filegroup")',
  'load("@viberoots//build-tools/rust:defs.bzl", "tauri_android_app", "tauri_app", "tauri_ios_app", "tauri_mobile_suite")',
].join("\n");
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());

async function writeBaseApp(app: string): Promise<void> {
  await fsp.mkdir(path.join(app, "src"), { recursive: true });
  await fsp.mkdir(path.join(app, "icons"), { recursive: true });
  await fsp.mkdir(path.join(app, "capabilities"), { recursive: true });
  await fsp.mkdir(path.join(app, "mobile"), { recursive: true });
  await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
  await fsp.writeFile(path.join(app, "Cargo.toml"), '[package]\nname="app"\nversion="0.1.0"\n');
  await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
  await fsp.writeFile(path.join(app, "tauri.conf.json"), "{}\n");
  await fsp.writeFile(path.join(app, "capabilities/default.json"), "{}\n");
  await fsp.writeFile(path.join(app, "icons/icon.png"), "icon\n");
  await fsp.writeFile(path.join(app, "mobile/android.config.json"), "{}\n");
  await fsp.writeFile(path.join(app, "mobile/ios.config.json"), "{}\n");
}

test("mobile Tauri macros are loadable but disabled during analysis", async () => {
  await runInTemp("rust-tauri-mobile-disabled-macros", async (tmp, $) => {
    const build = async (target: string) =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 build --target-platforms //:no_cgo ${target}`;
    for (const [macro, pkg] of [
      ["tauri_ios_app", "mobile-ios"],
      ["tauri_android_app", "mobile-android"],
    ]) {
      const app = path.join(tmp, `projects/apps/${pkg}`);
      await writeBaseApp(app);
      await fsp.writeFile(
        path.join(app, "TARGETS"),
        `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\n${macro}(name = "app", frontend_dist = ":frontend", icons = ["icons/icon.png"], srcs = ["src/main.rs"])\n`,
      );
      const result = await build(`//projects/apps/${pkg}:app`);
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), /platform-not-enabled/);
    }
  });
});

test("tauri_mobile_suite declares stable shared labels before builders land", async () => {
  await runInTemp("rust-tauri-mobile-suite-labels", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/mobile");
    await writeBaseApp(app);
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\ntauri_mobile_suite(name = "app", frontend_dist = ":frontend", icons = ["icons/icon.png"], srcs = ["src/main.rs"], capabilities = ["capabilities/default.json"])\n`,
    );
    const labels = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 uquery "set(//projects/apps/mobile:app_desktop //projects/apps/mobile:app_ios //projects/apps/mobile:app_android)"
    `;
    assert.match(String(labels.stdout), /app_desktop/);
    assert.match(String(labels.stdout), /app_ios/);
    assert.match(String(labels.stdout), /app_android/);
    const mobile = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo //projects/apps/mobile:app_android`;
    assert.notEqual(mobile.exitCode, 0);
    assert.match(String(mobile.stderr || mobile.stdout), /platform-not-enabled/);
  });
});

test("Tauri mobile source attrs stay package-relative and reject wildcards", async () => {
  await runInTemp("rust-tauri-mobile-source-attrs", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/mobile");
    await writeBaseApp(app);
    const target = "//projects/apps/mobile:desktop";
    const query = async () =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo ${target}`;
    const declaration = (extra: string) =>
      `${load}\ntauri_app(name = "desktop", crate = "app", frontend_dist = ":frontend", icons = ["icons/icon.png"], capabilities = ["capabilities/default.json"], srcs = ["src/main.rs"], ${extra})\n`;
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\n${declaration('android_config = "../outside.json"')}`,
    );
    let result = await query();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr || result.stdout),
      /android_config must remain package-relative/,
    );
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\n${declaration('ios_project_srcs = ["gen/mobile/ios/**"]')}`,
    );
    result = await query();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr || result.stdout),
      /ios_project_srcs does not accept wildcard paths/,
    );
  });
});

test("desktop Tauri includes reserved mobile attrs in public attrs and srcs", async () => {
  const result = await $({ cwd: sourceRoot, stdio: "pipe" })`
    buck2 uquery --json --output-attribute android_config --output-attribute android_project_srcs \
      --output-attribute ios_config --output-attribute ios_project_srcs --output-attribute srcs \
      //build-tools/tools/tests/fixtures/rust-tauri-app:desktop
  `;
  const contract = String(result.stdout);
  for (const expected of [
    "mobile/android.config.json",
    "gen/mobile/android/project.marker",
    "mobile/ios.config.json",
    "gen/mobile/ios/project.marker",
  ]) {
    assert.match(contract, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("non-Tauri Rust macros reject mobile helper attrs", async () => {
  await runInTemp("rust-non-tauri-mobile-attrs", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
    await fsp.writeFile(path.join(app, "src/lib.rs"), "pub fn demo() {}\n");
    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
    const macros: Array<[string, string]> = [
      ["rust_binary", 'rust_binary(name = "app", srcs = ["src/main.rs"], ATTR = "invalid")'],
      ["rust_library", 'rust_library(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")'],
      [
        "rust_static_library",
        'rust_static_library(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      ["rust_cdylib", 'rust_cdylib(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")'],
      ["rust_proc_macro", 'rust_proc_macro(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")'],
      ["rust_test", 'rust_test(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")'],
      [
        "rust_wasm_library",
        'rust_wasm_library(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_wasi_binary",
        'rust_wasi_binary(name = "app", srcs = ["src/main.rs"], ATTR = "invalid")',
      ],
      [
        "rust_wasm_static_library",
        'rust_wasm_static_library(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_wasm_browser_package",
        'rust_wasm_browser_package(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_wasm_component",
        'rust_wasm_component(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_python_extension",
        'rust_python_extension(name = "app", module = "rustapp", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_python_wasm_extension",
        'rust_python_wasm_extension(name = "app", backend = "pyodide", module = "rustapp", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      ["rust_node_addon", 'rust_node_addon(name = "app", srcs = ["src/lib.rs"], ATTR = "invalid")'],
      [
        "rust_c_ffi_library",
        'rust_c_ffi_library(name = "app", binding_config = "binding.json", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
      [
        "rust_cxx_bridge_library",
        'rust_cxx_bridge_library(name = "app", binding_config = "binding.json", srcs = ["src/lib.rs"], ATTR = "invalid")',
      ],
    ];
    for (const attr of [
      "android_config",
      "android_project_srcs",
      "ios_config",
      "ios_project_srcs",
    ]) {
      for (const [macro, declaration] of macros) {
        await fsp.writeFile(
          path.join(app, "TARGETS"),
          `load("@viberoots//build-tools/rust:defs.bzl", "${macro}")\n${declaration.replace("ATTR", attr)}\n`,
        );
        const result = await $({
          cwd: tmp,
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rustapp:app`;
        assert.notEqual(result.exitCode, 0);
        assert.match(
          String(result.stderr || result.stdout),
          new RegExp(`unknown arguments: ${attr}`),
        );
      }
    }
  });
});
