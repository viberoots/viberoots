{ pkgs, uv2nixLib ? null }:
args:
let
  lib = pkgs.lib;
  pname = args.pname or "py-unnamed";
  version = args.version or "0.0.0";
  src = args.srcAbs or args.src or ./.;
  lockfile = args.lockfile or null;
  subdir = args.subdir or ".";
  patchesMap = args.patchesMap or {};
  devOverrides = args.devOverrides or {};
  kind = args.kind or "app";
  wsRoot = args.wsRoot or null;
  groups = args.groups or [];
  siteOverlays = args.siteOverlays or [];

  _requireUv2nix = if uv2nixLib == null then builtins.throw "uv2nix backend requires uv2nixLib" else null;
  Uv2nixAdapter = import ../../../uv2nix-adapter.nix { inherit pkgs; uv2nixLib = uv2nixLib; };
in
Uv2nixAdapter {
  inherit pname version kind wsRoot groups;
  srcAbs = src;
  lockfile = lockfile;
  subdir = subdir;
  patchesMap = patchesMap;
  devOverrides = devOverrides;
  siteOverlays = siteOverlays;
}

