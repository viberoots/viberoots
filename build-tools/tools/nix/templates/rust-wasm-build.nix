{
  pkgs,
  rustToolchain ? pkgs.viberootsRustToolchain,
  lib,
  validatedTarget,
  cargoProfile,
  crate,
  kindFlags,
  featureFlags,
  targetFlags,
}:
let
  flags = [ "--offline" ] ++ lib.optionals (cargoProfile == "release") [ "--profile" "release" ]
    ++ [ "--locked" "--package" crate ] ++ kindFlags ++ featureFlags ++ targetFlags;
  command = lib.concatMapStringsSep " " lib.escapeShellArg flags;
in lib.optionalString (validatedTarget != "") ''
  runHook preBuild
  ${rustToolchain}/bin/cargo build -j "$NIX_BUILD_CORES" ${command}
  runHook postBuild
''
