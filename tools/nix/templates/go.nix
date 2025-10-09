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
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    pkgConfigNames ? {},
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
      # Resolve nixCgoAttrs like "pkgs.openssl" into concrete package values
      segs = s: let xs = lib.splitString "." s; in if xs == [] then [] else xs;
      getAtPath = attrs: parts:
        if parts == [] then attrs else (
          let k = lib.head parts; rest = lib.tail parts; in
            if (builtins.isAttrs attrs) && (builtins.hasAttr k attrs)
            then getAtPath (builtins.getAttr k attrs) rest
            else null
        );
      resolveAttr = s:
        let parts0 = segs s;
            parts = if parts0 != [] && (lib.head parts0) == "pkgs" then lib.tail parts0 else parts0;
        in getAtPath pkgs parts;
      resolvedCgo = builtins.filter (v: v != null) (map resolveAttr nixCgoAttrs);
      cgoPkgs = nixCgoPkgs ++ resolvedCgo;
      haveCgo = (builtins.length cgoPkgs) > 0;
      pkgCfgPaths = lib.concatStringsSep ":" (map (p: "${p}/lib/pkgconfig") cgoPkgs);
      synthCFlags = lib.concatStringsSep " " (map (p: "-I${p}/include") cgoPkgs);
      synthLdFlags = lib.concatStringsSep " " (map (p: "-L${p}/lib") cgoPkgs);
      baseArgs = {
        pname = "go-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "cmd/${targetName}" ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        nativeBuildInputs = ([ pkgs.unzip ] ++ (if haveCgo then (cgoPkgs ++ [ pkgs.pkg-config ]) else []));
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          ${if haveCgo then ''
            export CGO_ENABLED=1
            export PKG_CONFIG_PATH=${pkgCfgPaths}
            if [ -z "$PKG_CONFIG_PATH" ]; then
              export CGO_CFLAGS="${synthCFlags} $CGO_CFLAGS"
              export CGO_LDFLAGS="${synthLdFlags} $CGO_LDFLAGS"
            fi
          '' else ""}
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
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    pkgConfigNames ? {},
  }:
    let
      patchesMap = H.patchesMapFromDir patchDir;
      devOverridesEnv = H.readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      segs = s: let xs = lib.splitString "." s; in if xs == [] then [] else xs;
      getAtPath = attrs: parts:
        if parts == [] then attrs else (
          let k = lib.head parts; rest = lib.tail parts; in
            if (builtins.isAttrs attrs) && (builtins.hasAttr k attrs)
            then getAtPath (builtins.getAttr k attrs) rest
            else null
        );
      resolveAttr = s:
        let parts0 = segs s;
            parts = if parts0 != [] && (lib.head parts0) == "pkgs" then lib.tail parts0 else parts0;
        in getAtPath pkgs parts;
      resolvedCgo = builtins.filter (v: v != null) (map resolveAttr nixCgoAttrs);
      cgoPkgs = nixCgoPkgs ++ resolvedCgo;
      haveCgo = (builtins.length cgoPkgs) > 0;
      pkgCfgPaths = lib.concatStringsSep ":" (map (p: "${p}/lib/pkgconfig") cgoPkgs);
      synthCFlags = lib.concatStringsSep " " (map (p: "-I${p}/include") cgoPkgs);
      synthLdFlags = lib.concatStringsSep " " (map (p: "-L${p}/lib") cgoPkgs);
      baseArgs = {
        pname = "golib-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "." ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        nativeBuildInputs = (if haveCgo then (cgoPkgs ++ [ pkgs.pkg-config ]) else []);
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          export GOFLAGS="-mod=mod"
          ${if haveCgo then ''
            export CGO_ENABLED=1
            export PKG_CONFIG_PATH=${pkgCfgPaths}
            if [ -z "$PKG_CONFIG_PATH" ]; then
              export CGO_CFLAGS="${synthCFlags} $CGO_CFLAGS"
              export CGO_LDFLAGS="${synthLdFlags} $CGO_LDFLAGS"
            fi
          '' else ""}
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


