#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const load =
  'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_wasi_binary", "rust_wasm_browser_package", "rust_wasm_component", "rust_wasm_library", "rust_wasm_static_library")';

test("rust macros reject noncanonical Cargo inputs, patch traversal, and unknown attrs", async () => {
  await runInTemp("rust-cargo-input-analysis-errors-missing", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"])\n`,
    );
    const missing = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rustapp:app`;
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || missing.stdout), /exactly one package-local Cargo\.toml/);
  });

  await runInTemp("rust-cargo-input-analysis-errors", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/rustapp");
    await fsp.mkdir(path.join(app, "src"), { recursive: true });
    await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
    const targets = path.join(app, "TARGETS");
    const query = async () =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/apps/rustapp:app`;

    await fsp.writeFile(
      path.join(app, "Cargo.toml"),
      '[package]\nname="rustapp"\nversion="0.1.0"\n',
    );
    await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
    await fsp.mkdir(path.join(app, "alternate"));
    await fsp.writeFile(path.join(app, "alternate/Cargo.toml"), "[workspace]\n");
    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_manifest = ["Cargo.toml", "alternate/Cargo.toml"], srcs = ["src/main.rs"])\n`,
    );
    const ambiguous = await query();
    assert.notEqual(ambiguous.exitCode, 0);
    assert.match(
      String(ambiguous.stderr || ambiguous.stdout),
      /cargo_manifest must identify exactly one file/,
    );

    await fsp.writeFile(path.join(app, "Alternate.toml"), "[workspace]\n");
    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_manifest = "Alternate.toml", srcs = ["src/main.rs"])\n`,
    );
    const alternateManifest = await query();
    assert.notEqual(alternateManifest.exitCode, 0);
    assert.match(
      String(alternateManifest.stderr || alternateManifest.stdout),
      /cargo_manifest must be the canonical package-local Cargo\.toml/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", cargo_lock = "//projects/libs/shared:Cargo.lock", srcs = ["src/main.rs"])\n`,
    );
    const crossRootLock = await query();
    assert.notEqual(crossRootLock.exitCode, 0);
    assert.match(
      String(crossRootLock.stderr || crossRootLock.stdout),
      /cargo_lock must be the canonical package-local Cargo\.lock/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", local_patch_dirs = ["../shared/patches/rust"], srcs = ["src/main.rs"])\n`,
    );
    const patchTraversal = await query();
    assert.notEqual(patchTraversal.exitCode, 0);
    assert.match(
      String(patchTraversal.stderr || patchTraversal.stdout),
      /local_patch_dirs must remain within the package/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", imaginary_fallback = True, srcs = ["src/main.rs"])\n`,
    );
    const unknown = await query();
    assert.notEqual(unknown.exitCode, 0);
    assert.match(String(unknown.stderr || unknown.stdout), /unknown arguments: imaginary_fallback/);

    for (const tauriOnlyArg of [
      "frontend_dist",
      "tauri_target_platform",
      "tauri_artifact_kind",
      "tauri_bundle_identifier",
      "tauri_signing_mode",
      "tauri_deployment_eligibility",
      "app_windows",
      "app_commands",
      "capabilities",
      "icons",
      "permissions",
      "resources",
      "sidecar_deps",
      "tauri_config",
      "tauri_package_name",
      "tauri_platform",
      "tauri_root",
    ]) {
      await fsp.writeFile(
        targets,
        `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"], ${tauriOnlyArg} = "invalid")\n`,
      );
      const rejectedTauriOnlyArg = await query();
      assert.notEqual(rejectedTauriOnlyArg.exitCode, 0);
      assert.match(
        String(rejectedTauriOnlyArg.stderr || rejectedTauriOnlyArg.stdout),
        new RegExp(`unknown arguments: ${tauriOnlyArg}`),
      );
    }

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"], link_deps = [":native"], link_closure_overrides = {":other": "transitive"})\n`,
    );
    const invalidOverride = await query();
    assert.notEqual(invalidOverride.exitCode, 0);
    assert.match(
      String(invalidOverride.stderr || invalidOverride.stdout),
      /native link_deps\/header_deps are private bridge wiring/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"], target = "wasm32-unknown-unknown")\n`,
    );
    const invalidNativeTarget = await query();
    assert.notEqual(invalidNativeTarget.exitCode, 0);
    assert.match(String(invalidNativeTarget.stderr || invalidNativeTarget.stdout), /must be empty/);

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasm_library(name = "app", srcs = ["src/main.rs"], target = "wasm32-wasip1")\n`,
    );
    const invalidWasmTarget = await query();
    assert.notEqual(invalidWasmTarget.exitCode, 0);
    assert.match(
      String(invalidWasmTarget.stderr || invalidWasmTarget.stdout),
      /rust_wasm_library: target must be wasm32-unknown-unknown/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasi_binary(name = "app", srcs = ["src/main.rs"], target = "wasm32-unknown-unknown")\n`,
    );
    const invalidWasiTarget = await query();
    assert.notEqual(invalidWasiTarget.exitCode, 0);
    assert.match(
      String(invalidWasiTarget.stderr || invalidWasiTarget.stdout),
      /rust_wasi_binary: target must be wasm32-wasip1/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasm_library(name = "app", srcs = ["src/main.rs"], header_deps = [":native"])\n`,
    );
    const wasmLinkDeps = await query();
    assert.notEqual(wasmLinkDeps.exitCode, 0);
    assert.match(
      String(wasmLinkDeps.stderr || wasmLinkDeps.stdout),
      /header_deps and nixpkg dependencies are unsupported for Rust WASM targets/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasi_binary(name = "app", srcs = ["src/main.rs"], header_deps = [":headers"])\n`,
    );
    const wasiHeaderDeps = await query();
    assert.notEqual(wasiHeaderDeps.exitCode, 0);
    assert.match(
      String(wasiHeaderDeps.stderr || wasiHeaderDeps.stdout),
      /header_deps and nixpkg dependencies are unsupported for Rust WASM targets/,
    );

    for (const declaration of [
      'rust_wasm_library(name = "app", srcs = ["src/main.rs"], nixpkg_deps = ["zlib"])',
      'rust_wasi_binary(name = "app", srcs = ["src/main.rs"], labels = ["nixpkg:pkgs.zlib"])',
    ]) {
      await fsp.writeFile(targets, `${load}\n${declaration}\n`);
      const result = await query();
      assert.notEqual(result.exitCode, 0);
      assert.match(
        String(result.stderr || result.stdout),
        /header_deps and nixpkg dependencies are unsupported for Rust WASM targets/,
      );
    }

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasm_library(name = "app", srcs = ["src/main.rs"], imaginary_fallback = True)\n`,
    );
    const unknownWasmArgument = await query();
    assert.notEqual(unknownWasmArgument.exitCode, 0);
    assert.match(
      String(unknownWasmArgument.stderr || unknownWasmArgument.stdout),
      /rust_wasm_library: unknown arguments: imaginary_fallback/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_wasi_binary(name = "app", srcs = ["src/main.rs"], imaginary_fallback = True)\n`,
    );
    const unknownWasiArgument = await query();
    assert.notEqual(unknownWasiArgument.exitCode, 0);
    assert.match(
      String(unknownWasiArgument.stderr || unknownWasiArgument.stdout),
      /rust_wasi_binary: unknown arguments: imaginary_fallback/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"], behavior_probe = "custom")\n`,
    );
    const invalidBehaviorProbe = await query();
    assert.notEqual(invalidBehaviorProbe.exitCode, 0);
    assert.match(
      String(invalidBehaviorProbe.stderr || invalidBehaviorProbe.stdout),
      /behavior_probe must be a bool/,
    );

    await fsp.writeFile(
      targets,
      `${load}\nrust_binary(name = "app", srcs = ["src/main.rs"], nixpkg_deps = ["zlib"])\n`,
    );
    const nativeNixpkg = await query();
    assert.equal(nativeNixpkg.exitCode, 0, String(nativeNixpkg.stderr || nativeNixpkg.stdout));
  });
});
