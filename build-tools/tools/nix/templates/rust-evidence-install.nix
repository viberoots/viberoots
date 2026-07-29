{
  lib,
  kind,
  coverage,
  interopContract,
  wasmPostprocess,
  compositionEvidence,
  dependencyInventory,
  extensionRuntime,
  H,
  name,
  sourcePlan,
  artifactNixRoot,
  pkgs,
  producerLineage,
}:
lib.optionalString (kind == "test" && coverage) ''
  install -Dm644 .viberoots-rust-coverage.lcov "$out/coverage/lcov.info"
'' + ''
  ${interopContract.install} ${wasmPostprocess.install}
  mkdir -p "$out/share/viberoots-rust"
  cat > "$out/share/viberoots-rust/composition.json" <<'VIBEROOTS_RUST_COMPOSITION'
  ${builtins.toJSON compositionEvidence}
  VIBEROOTS_RUST_COMPOSITION
  cat > "$out/share/viberoots-rust/dependency-inventory.json" <<'VIBEROOTS_RUST_INVENTORY'
  ${builtins.toJSON dependencyInventory}
  VIBEROOTS_RUST_INVENTORY
  cat > "$out/share/viberoots-rust/materialization-manifest.json" <<VIBEROOTS_RUST_MATERIALIZATION
  ${builtins.toJSON (import ./rust-materialization.nix {
    inherit H name sourcePlan artifactNixRoot pkgs compositionEvidence
      producerLineage wasmPostprocess interopContract dependencyInventory;
  })}
  VIBEROOTS_RUST_MATERIALIZATION
  substituteInPlace "$out/share/viberoots-rust/materialization-manifest.json" \
    --replace-fail "__VIBEROOTS_RUST_OUT__" "$out" \
    --replace-fail "__VIBEROOTS_RUST_IDENTITY__" "$(basename "$out")"
  ${extensionRuntime}
''
