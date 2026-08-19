#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { parseInventoryNixRouteDetails } from "../../dev/nix-gaps-inventory-check-lib";
import {
  rustImplementationRouteErrors,
  rustDefsBzlPath,
} from "../../dev/nix-gaps-inventory-rust-routes";
import { parseStarlarkIndexMacrosByModule } from "../../dev/nix-gaps-inventory-check-lib";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function routeInputs() {
  const [rustDefs, starlarkApi, nixGaps, langs] = await Promise.all([
    fs.readFile(viberootsSourcePath("viberoots/build-tools/rust/defs.bzl"), "utf8"),
    fs.readFile(viberootsSourcePath("viberoots/docs/handbook/starlark-api.md"), "utf8"),
    fs.readFile(viberootsSourcePath("viberoots/docs/handbook/nix-gaps.md"), "utf8"),
    fs.readFile(viberootsSourcePath("viberoots/build-tools/tools/nix/langs.json"), "utf8"),
  ]);
  const rustLang = JSON.parse(langs).languages.find(
    (language: { id?: string }) => language.id === "rust",
  );
  return {
    rustDefs,
    publicMacros: parseStarlarkIndexMacrosByModule(starlarkApi)[rustDefsBzlPath] || [],
    nixRouteDetailsByMacro: parseInventoryNixRouteDetails(nixGaps),
    plannedRoutes: rustLang?.plannedRoutes || [],
  };
}

test("every public Rust macro follows its reviewed Nix route", async () => {
  assert.deepEqual(rustImplementationRouteErrors(await routeInputs()), []);
});

test("Rust route drift is rejected when a public macro bypasses the reviewed route", async () => {
  const inputs = await routeInputs();
  const drifted = inputs.rustDefs.replace(
    "def rust_wasi_binary(name, **kwargs):",
    'def rust_wasi_binary(name, **kwargs):\n    native.genrule(name = name, out = name + ".wasm", cmd = "touch $OUT")\n\n' +
      "def _obsolete_rust_wasi_binary(name, **kwargs):",
  );
  assert.match(
    rustImplementationRouteErrors({ ...inputs, rustDefs: drifted }).join("\n"),
    /rust_wasi_binary does not call _rust_nix_target/,
  );
});

test("Rust route drift is rejected when route documentation is missing", async () => {
  const inputs = await routeInputs();
  delete inputs.nixRouteDetailsByMacro.rust_wasm_library;
  assert.match(
    rustImplementationRouteErrors(inputs).join("\n"),
    /rust_wasm_library do not name rust_nix_build/,
  );
});

test("Rust planned-not-loadable mobile routes are rejected when promoted to public macros", async () => {
  const inputs = await routeInputs();
  assert.match(
    rustImplementationRouteErrors({
      ...inputs,
      plannedRoutes: inputs.plannedRoutes.map((route: any) =>
        route.macro === "tauri_ios_app" ? { ...route, state: "planned-not-loadable" } : route,
      ),
    }).join("\n"),
    /tauri_ios_app must stay out of active public macros/,
  );
});
