{
  kind, crate, features, profile, crateType, hostRole, generatedOutputs,
  module, buildPyDeps, addonName, nodeApiVersion, platform, pythonAbi,
  pythonWheelhouse, interopContract, validatedPublicCrate, validatedTarget,
  defaultFeatures, sourcePlan, producerLineage, cargoOutputHashes,
  cargoFixedSources, vendorAuthorities, nativeInputs, sourceComposition,
  runtimePackages, wasm, wasmPostprocess, cargoLock, dependencyInventory,
  pyemscriptenContract ? { enabled = false; config = {}; },
}:
{
  inherit kind crate features profile crateType hostRole generatedOutputs
    module buildPyDeps addonName nodeApiVersion platform pythonAbi pythonWheelhouse;
  interop = interopContract.passthru;
  publicCrate = validatedPublicCrate;
  target = validatedTarget;
  default_features = defaultFeatures;
  nixpkgs_profile = sourcePlan.nixpkgs_profile;
  nixpkg_pins = sourcePlan.nixpkg_pins;
  cargo_manifest = "${producerLineage.sourceSnapshot}/Cargo.toml";
  cargo_lock = "${producerLineage.sourceSnapshot}/Cargo.lock";
  cargo_output_hashes = cargoOutputHashes;
  cargo_fixed_sources = cargoFixedSources;
  patch_vendor_authorities = vendorAuthorities;
  native_link_inputs = map builtins.toString nativeInputs.libraries;
  native_header_inputs = map builtins.toString nativeInputs.headers;
  composition = if sourceComposition == null then [] else sourceComposition.diagnostics;
  composition_manifest = if sourceComposition == null then [] else sourceComposition.manifest;
  composition_digest = if sourceComposition == null then
    builtins.hashString "sha256" (builtins.toJSON []) else sourceComposition.digest;
  sourceRevision = producerLineage.revision;
  runtime_closure = map builtins.toString
    (runtimePackages ++ interopContract.runtimePackages);
  runtime_packages = runtimePackages ++ interopContract.runtimePackages;
  wasm = wasm // wasmPostprocess.passthru;
  pyemscripten = if pyemscriptenContract.enabled then pyemscriptenContract.config else {};
  cargo_packages = dependencyInventory;
}
