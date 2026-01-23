{ lib, siteOverlays }:
let
  siteOverlays0 = siteOverlays;
  siteOverlaysOk =
    if builtins.isList siteOverlays0 then siteOverlays0
    else builtins.throw "uv2nix adapter: siteOverlays must be a list";
  overlayArgs =
    let
      asArg = x: lib.escapeShellArg (builtins.toString x);
    in lib.concatStringsSep " " (builtins.map asArg siteOverlaysOk);
in {
  siteOverlays = siteOverlaysOk;
  inherit overlayArgs;
}
