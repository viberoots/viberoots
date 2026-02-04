{ pkgs }:
# build-tools/tools/nix/templates/rust.nix — Rust templates (skeleton)
ctx:
{
  rustApp = { name, srcRoot ? ./. }:
    pkgs.runCommand "rust-${name}" {} ''
      mkdir -p "$out"
      echo Rust > "$out/README"
    '';

  rustLib = { name, srcRoot ? ./. }:
    pkgs.runCommand "rustlib-${name}" {} ''
      mkdir -p "$out"
      echo Rust-lib > "$out/README"
    '';
}
