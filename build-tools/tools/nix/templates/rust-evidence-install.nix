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
  isWasm,
}:
lib.optionalString (kind == "test" && coverage) ''
  install -Dm644 .viberoots-rust-coverage.lcov "$out/coverage/lcov.info"
'' + ''
  ${interopContract.install} ${wasmPostprocess.runtimeInstall}
  evidenceRoot=${if isWasm then ''"$provenance"'' else ''"$out"''}
  ${wasmPostprocess.evidenceInstall}
  mkdir -p "$evidenceRoot/share/viberoots-rust"
  cat > "$evidenceRoot/share/viberoots-rust/composition.json" <<'VIBEROOTS_RUST_COMPOSITION'
  ${builtins.toJSON compositionEvidence}
  VIBEROOTS_RUST_COMPOSITION
  cat > "$evidenceRoot/share/viberoots-rust/dependency-inventory.json" <<'VIBEROOTS_RUST_INVENTORY'
  ${builtins.toJSON dependencyInventory}
  VIBEROOTS_RUST_INVENTORY
  cat > "$evidenceRoot/share/viberoots-rust/materialization-manifest.json" <<VIBEROOTS_RUST_MATERIALIZATION
  ${builtins.toJSON (import ./rust-materialization.nix {
    inherit H name sourcePlan artifactNixRoot pkgs compositionEvidence
      producerLineage wasmPostprocess interopContract dependencyInventory;
  })}
  VIBEROOTS_RUST_MATERIALIZATION
  substituteInPlace "$evidenceRoot/share/viberoots-rust/materialization-manifest.json" \
    --replace-fail "__VIBEROOTS_RUST_OUT__" "$out" \
    --replace-fail "__VIBEROOTS_RUST_IDENTITY__" "$(basename "$out")" \
    --replace-fail "__VIBEROOTS_RUST_PROVENANCE__" "$evidenceRoot" \
    --replace-fail "__VIBEROOTS_RUST_PROVENANCE_IDENTITY__" "$(basename "$evidenceRoot")"
  ${extensionRuntime}
''
