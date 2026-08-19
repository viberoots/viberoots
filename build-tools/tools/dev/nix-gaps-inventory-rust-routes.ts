import * as fs from "node:fs/promises";
import path from "node:path";
import { bzlDefBody, parsePublicStarlarkDefs } from "./nix-gaps-inventory-check-lib";

export const rustDefsBzlPath = "@viberoots//build-tools/rust:defs.bzl";

type PlannedRustRoute = {
  macro: string;
  state: string;
  platform: string;
  artifactKinds: string[];
};

const expectedRouteHelper: Record<string, string> = {
  tauri_app: "rust_nix_build",
  rust_binary: "rust_nix_build",
  rust_c_ffi_library: "rust_nix_build",
  rust_cdylib: "rust_nix_build",
  rust_cxx_bridge_library: "rust_nix_build",
  rust_library: "rust_nix_build",
  rust_node_addon: "rust_nix_build",
  rust_proc_macro: "rust_nix_build",
  rust_python_extension: "rust_nix_build",
  rust_python_wasm_extension: "rust_nix_build",
  rust_static_library: "rust_nix_build",
  rust_test: "rust_nix_test",
  rust_wasi_binary: "rust_nix_build",
  rust_wasm_browser_package: "rust_nix_build",
  rust_wasm_component: "rust_nix_build",
  rust_wasm_library: "rust_nix_build",
  rust_wasm_static_library: "rust_nix_build",
};

const expectedPlannedRoutes: PlannedRustRoute[] = [
  {
    macro: "tauri_android_app",
    state: "loadable-disabled",
    platform: "android",
    artifactKinds: ["android-debug-apk", "android-unsigned-aab", "android-signed-aab"],
  },
  {
    macro: "tauri_ios_app",
    state: "loadable-disabled",
    platform: "ios",
    artifactKinds: ["ios-simulator-bundle", "ios-unsigned-archive", "ios-signed-ipa"],
  },
  {
    macro: "tauri_mobile_suite",
    state: "loadable-disabled",
    platform: "multi",
    artifactKinds: ["macos-app", "ios-simulator-bundle", "android-debug-apk"],
  },
];

function sortedPlannedRoutes(routes: PlannedRustRoute[]): PlannedRustRoute[] {
  return [...routes]
    .map((route) => ({
      macro: route.macro,
      state: route.state,
      platform: route.platform,
      artifactKinds: [...route.artifactKinds].sort(),
    }))
    .sort((a, b) => a.macro.localeCompare(b.macro));
}

export function rustImplementationRouteErrors(opts: {
  rustDefs: string;
  publicMacros: string[];
  nixRouteDetailsByMacro: Record<string, string>;
  plannedRoutes?: PlannedRustRoute[];
}): string[] {
  const errors: string[] = [];
  const actualPublicMacros = parsePublicStarlarkDefs(opts.rustDefs);
  const expectedMacros = Object.keys(expectedRouteHelper).sort();
  const documentedMacros = [...opts.publicMacros].sort();
  const plannedRoutes = sortedPlannedRoutes(opts.plannedRoutes || []);
  const loadableDisabledMacros = plannedRoutes
    .filter((route) => route.state === "loadable-disabled")
    .map((route) => route.macro)
    .sort();
  const notLoadablePlannedMacros = plannedRoutes
    .filter((route) => route.state !== "loadable-disabled")
    .map((route) => route.macro)
    .sort();
  const expectedActualMacros = [...expectedMacros, ...loadableDisabledMacros].sort();
  if (actualPublicMacros.sort().join(",") !== expectedActualMacros.join(",")) {
    errors.push("Rust public macro inventory does not match build-tools/rust/defs.bzl");
  }
  if (documentedMacros.join(",") !== expectedMacros.join(",")) {
    errors.push("Rust public macro inventory does not match the reviewed route set");
  }
  for (const macro of expectedMacros) {
    const body = bzlDefBody(opts.rustDefs, macro);
    if (!body.includes("_rust_nix_target(")) {
      errors.push(`Rust implementation route for ${macro} does not call _rust_nix_target`);
    }
    const routeDetail = opts.nixRouteDetailsByMacro[macro] || "";
    if (!routeDetail.includes(expectedRouteHelper[macro])) {
      errors.push(`Rust route docs for ${macro} do not name ${expectedRouteHelper[macro]}`);
    }
  }
  if (
    JSON.stringify(plannedRoutes) !== JSON.stringify(sortedPlannedRoutes(expectedPlannedRoutes))
  ) {
    errors.push("Rust planned mobile route inventory does not match the reviewed route set");
  }
  for (const macro of notLoadablePlannedMacros) {
    if (documentedMacros.includes(macro) || actualPublicMacros.includes(macro)) {
      errors.push(`Rust planned mobile route ${macro} must stay out of active public macros`);
    }
  }
  for (const macro of plannedRoutes.map((route) => route.macro)) {
    if (opts.nixRouteDetailsByMacro[macro]) {
      errors.push(`Rust planned mobile route ${macro} must stay out of active Nix route docs`);
    }
  }
  if (!opts.rustDefs.includes('"rust_nix_build"') || !opts.rustDefs.includes('"rust_nix_test"')) {
    errors.push("Rust implementation does not load both reviewed Nix route helpers");
  }
  return errors;
}

export async function enforceRustImplementationRouteChecks(
  source: string,
  publicMacros: string[],
  nixRouteDetailsByMacro: Record<string, string>,
): Promise<void> {
  const [rustDefs, langsJson] = await Promise.all([
    fs.readFile(path.join(source, "build-tools/rust/defs.bzl"), "utf8"),
    fs.readFile(path.join(source, "build-tools/tools/nix/langs.json"), "utf8"),
  ]);
  const rustLang = JSON.parse(langsJson).languages.find(
    (language: { id?: string }) => language.id === "rust",
  );
  const errors = rustImplementationRouteErrors({
    rustDefs,
    publicMacros,
    nixRouteDetailsByMacro,
    plannedRoutes: rustLang?.plannedRoutes || [],
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
