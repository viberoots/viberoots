{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };

  buildGoFn = if pkgs ? buildGoApplication then pkgs.buildGoApplication
              else builtins.throw "gomod2nix overlay (buildGoApplication) is required; no vendoring fallback";
  takesOverrides = (builtins.hasAttr "overrides" (builtins.functionArgs (pkgs.buildGoApplication)));

in {
  goApp = {
    name,
    modulesToml,
    devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON",
    devOverridesMap ? {},
    subdir ? ".",
    srcRoot ? ../../..,
    patchDir ? ../../patches/go,
  }:
    let
      patchesMap = H.patchesMapFromDir patchDir;
      devOverridesEnv = H.readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      devOverrides = (devOverridesMap // devOverridesEnv);
      targetName = let parts = lib.splitString ":" name; in
        if (builtins.length parts) > 1 then lib.elemAt parts 1
        else (
          let left = lib.elemAt parts 0; segs = lib.splitString "/" left; in
          if (builtins.length segs) > 0 then lib.elemAt segs ((builtins.length segs) - 1) else left
        );
      moduleRootRel = lib.removeSuffix "/cmd/${targetName}" subdir;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + moduleRootRel));
      baseArgs = {
        pname = "go-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "cmd/${targetName}" ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        nativeBuildInputs = [ pkgs.unzip ];
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          cd "''${modRoot:-.}"

          runHook postConfigure
        '';
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = module: old:
          let
            mType = builtins.typeOf module;
            pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
            ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
            keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
            patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
            srcOverride = if builtins.hasAttr keyWithVer devOverrides
                          then devOverrides.${keyWithVer}
                          else (devOverrides.${pkg} or old.src);
          in old // {
            patches = (old.patches or []) ++ patchList;
            src = srcOverride;
          };
      } else {}));
    in buildGoFn args;

  goLib = {
    name,
    modulesToml,
    devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDir ? ../../patches/go,
  }:
    let
      patchesMap = H.patchesMapFromDir patchDir;
      devOverridesEnv = H.readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      baseArgs = {
        pname = "golib-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "." ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          export GOFLAGS="-mod=mod"
          cd "''${modRoot:-.}"

          runHook postConfigure
        '';
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = module: old:
          let
            mType = builtins.typeOf module;
            pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
            ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
            keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
            patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
            srcOverride = if builtins.hasAttr keyWithVer devOverridesEnv
                          then devOverridesEnv.${keyWithVer}
                          else (devOverridesEnv.${pkg} or old.src);
          in old // {
            patches = (old.patches or []) ++ patchList;
            src = srcOverride;
          };
      } else {}));
    in buildGoFn args;
}


