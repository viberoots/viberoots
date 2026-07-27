import * as fs from "node:fs/promises";
import path from "node:path";
import { bzlDefBody, parsePublicStarlarkDefs } from "./nix-gaps-inventory-check-lib";

export const rustDefsBzlPath = "@viberoots//build-tools/rust:defs.bzl";

const expectedRouteHelper: Record<string, string> = {
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
  rust_wasm_library: "rust_nix_build",
};

export function rustImplementationRouteErrors(opts: {
  rustDefs: string;
  publicMacros: string[];
  nixRouteDetailsByMacro: Record<string, string>;
}): string[] {
  const errors: string[] = [];
  const actualPublicMacros = parsePublicStarlarkDefs(opts.rustDefs);
  const expectedMacros = Object.keys(expectedRouteHelper).sort();
  const documentedMacros = [...opts.publicMacros].sort();
  if (actualPublicMacros.sort().join(",") !== documentedMacros.join(",")) {
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
  const rustDefs = await fs.readFile(path.join(source, "build-tools/rust/defs.bzl"), "utf8");
  const errors = rustImplementationRouteErrors({
    rustDefs,
    publicMacros,
    nixRouteDetailsByMacro,
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
