{ lib, pkgs, args }:
let
  pname = args.pname or "py-unnamed";
  version = args.version or "0.0.0";
  src = args.srcAbs or args.src or ./.;
  lockfile = args.lockfile or null;
  subdir = args.subdir or ".";
  kind = args.kind or "app";
  wsRoot = args.wsRoot or null;
  ensureAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw ("uv2nix adapter: expected " + ctxStr + " to be an attrset");
  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("uv2nix adapter: expected " + ctxStr + " to be a list of strings");
  patchesMap = ensureAttrs "patchesMap" (args.patchesMap or {});
  devOverrides = ensureAttrs "devOverrides" (args.devOverrides or {});
  groups = ensureStringList "groups" (args.groups or []);
  siteOverlays = args.siteOverlays or [];

  isAbs = p: lib.hasPrefix "/" p;
  isRepoRel = p: lib.hasPrefix "projects/apps/" p || lib.hasPrefix "projects/libs/" p;
  isStorePath = p: lib.hasPrefix "/nix/store/" p;
  toStore = p: builtins.toString (builtins.path { path = builtins.toPath p; name = "uv-dev"; });

  wsRootOk = wsRoot != null && wsRoot != "";
  originRoot =
    if wsRootOk then wsRoot
    else builtins.throw "uv2nix adapter: explicit wsRoot is required";

  devOverridesCoerced =
    let keys = builtins.attrNames devOverrides;
        step = acc: k:
          let v = devOverrides.${k};
              vv =
                if v == null then null else (
                  if isStorePath v then v
                  else if isAbs v then toStore v
                  else if isRepoRel v then toStore (originRoot + "/" + v)
                  else toStore (builtins.toString src + "/" + v)
                );
          in acc // { "${k}" = vv; };
    in builtins.foldl' step {} keys;

  testResolveJSON = builtins.getEnv "NIX_PY_TEST_RESOLVE_JSON";
  patchesMapFile = pkgs.writeText "py-patches.json" (builtins.toJSON patchesMap);
  devOverridesFile = pkgs.writeText "py-dev-overrides.json" (builtins.toJSON devOverridesCoerced);
  testResolveFile =
    if testResolveJSON != "" then pkgs.writeText "py-test-resolve.json" testResolveJSON
    else pkgs.writeText "py-test-resolve.json" "{}";

  testResolveObj =
    let raw = if testResolveJSON != "" then (builtins.fromJSON testResolveJSON) else {};
        names = builtins.attrNames raw;
        isRepoRel = p: lib.hasPrefix "projects/apps/" p || lib.hasPrefix "projects/libs/" p;
        isAbs = p: lib.hasPrefix "/" p;
        toStore = p: builtins.toString (builtins.path { path = builtins.toPath p; name = "uv-src"; });
        step = acc: name:
          let entry = raw.${name};
              ver = entry.version or null;
              origin = entry.originPath or null;
              storeOrigin =
                if origin == null then null else (
                  if isAbs origin then toStore origin
                  else if isRepoRel origin then toStore (originRoot + "/" + origin)
                  else toStore (builtins.toString src + "/" + origin)
                );
              value = if storeOrigin != null then ({ version = ver; originPath = storeOrigin; })
                      else if origin != null then ({ version = ver; originPath = origin; })
                      else ({ version = ver; });
          in acc // { "${name}" = value; };
    in builtins.foldl' step {} names;
in {
  inherit pname version src lockfile subdir kind wsRoot groups;
  inherit patchesMap devOverrides devOverridesCoerced siteOverlays;
  inherit originRoot testResolveJSON patchesMapFile devOverridesFile testResolveFile testResolveObj;
}
