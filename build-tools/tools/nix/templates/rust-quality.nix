{ pkgs, lib, rustToolchain, crate, packagePath, featureFlags, coverage }:
let
  escapedFeatures = lib.concatMapStringsSep " " lib.escapeShellArg featureFlags;
  common = "--offline --locked --package ${lib.escapeShellArg crate} ${escapedFeatures}";
in {
  checks = ''
    export RUSTDOC=${rustToolchain}/bin/rustdoc
    export RUSTFMT=${rustToolchain}/bin/rustfmt
    ${rustToolchain}/bin/cargo fmt --all --check
    ${rustToolchain}/bin/cargo clippy ${common} --all-targets -- -D warnings
    ${rustToolchain}/bin/cargo test ${common} --doc
    ${rustToolchain}/bin/cargo test ${common} --benches --no-run
  '';
  coverage = lib.optionalString coverage ''
    PATH=${pkgs.viberootsCargoLlvmCov}/bin:$PATH \
      ${rustToolchain}/bin/cargo llvm-cov \
        ${common} --tests --lcov --output-path .viberoots-rust-coverage.lcov
    sed -i "s|^SF:$PWD/|SF:${packagePath}/|" .viberoots-rust-coverage.lcov
    test -s .viberoots-rust-coverage.lcov
  '';
}
