{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };

  buildGoFn = if pkgs ? buildGoApplication then pkgs.buildGoApplication
              else builtins.throw "gomod2nix overlay (buildGoApplication) is required; no vendoring fallback";
  takesOverrides = (builtins.hasAttr "overrides" (builtins.functionArgs (pkgs.buildGoApplication)));

  # Shared override composition for Go module patches and dev src overrides.
  mkOverrides = { patchesMap, devMap }:
    (module: old:
      let
        mType = builtins.typeOf module;
        pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
        ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
        keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
        patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
        srcOverride = if builtins.hasAttr keyWithVer devMap
                      then devMap.${keyWithVer}
                      else (devMap.${pkg} or old.src);
      in old // {
        patches = (old.patches or []) ++ patchList;
        src = srcOverride;
      }
    );

  mkCgoEnv = { nixCgoPkgs ? [], nixCgoAttrs ? [], repoCgoPkgs ? [] }:
    let
      resolvedCgo = builtins.filter (v: v != null) (map H.resolveAttrFromPkgs nixCgoAttrs);
      cgoPkgs = nixCgoPkgs ++ resolvedCgo ++ repoCgoPkgs;
      haveCgo = (builtins.length cgoPkgs) > 0;
      pkgCfgPaths = lib.concatStringsSep ":" (map (p: "${p}/lib/pkgconfig") cgoPkgs);
      synthCFlags = lib.concatStringsSep " " (map (p: "-I${p}/include") cgoPkgs);
      synthLdFlags = lib.concatStringsSep " " (map (p: "-L${p}/lib") cgoPkgs);
      repoStaticLibs = lib.concatStringsSep " " (map (p: let a = "${p}/lib"; in ''$(ls -1 "${a}" 2>/dev/null | sed -n 's/^lib\(.*\)\.a$/-l\1/p' | tr '\n' ' ')'') repoCgoPkgs);
    in {
      inherit cgoPkgs haveCgo pkgCfgPaths synthCFlags synthLdFlags repoStaticLibs;
    };

  # Tiny composer for shared configure/env steps used by goApp and goLib
  mkConfigurePhase = { cgo, includeGoFlags ? false }:
    ''
      runHook preConfigure

      export GOCACHE=$TMPDIR/go-cache
      export GOPATH="$TMPDIR/go"
      export GOSUMDB=off
      ${if includeGoFlags then ''
        export GOFLAGS="-mod=mod"
      '' else ""}
      ${if cgo.haveCgo then ''
        export CGO_ENABLED=1
        export PKG_CONFIG_PATH=${cgo.pkgCfgPaths}
        if [ -z "$PKG_CONFIG_PATH" ]; then
          export CGO_CFLAGS="${cgo.synthCFlags} $CGO_CFLAGS"
          export CGO_LDFLAGS="${cgo.synthLdFlags} ${cgo.repoStaticLibs} $CGO_LDFLAGS"
        fi
      '' else ''
        export CGO_ENABLED=0
      ''}
      cd "''${modRoot:-.}"

      runHook postConfigure
    '';

in {
  goApp = {
    name,
    modulesToml,
    devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON",
    devOverridesMap ? {},
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [],
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    pkgConfigNames ? {},
    repoCgoPkgs ? [],
  }:
    let
      # Merge patches from multiple directories; preserve keys and lists
      patchesMap = let
        scan = dir: H.patchesMapFromDir dir;
        merge = a: b: pkgs.lib.foldlAttrs (acc: k: v: acc // { "${k}" = (acc.${k} or []) ++ v; }) a b;
      in pkgs.lib.foldl' merge {} (map scan patchDirs);
      devOverridesFromEnv = H.readDevOverrides devOverrideEnv;
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      devOverrides = (devOverridesMap // devOverridesFromEnv);
      targetName = let parts = lib.splitString ":" name; in
        if (builtins.length parts) > 1 then lib.elemAt parts 1
        else (
          let left = lib.elemAt parts 0; segs = lib.splitString "/" left; in
          if (builtins.length segs) > 0 then lib.elemAt segs ((builtins.length segs) - 1) else left
        );
      moduleRootRel = lib.removeSuffix "/cmd/${targetName}" subdir;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + moduleRootRel));
      cgo = mkCgoEnv { inherit nixCgoPkgs nixCgoAttrs repoCgoPkgs; };
      baseArgs = {
        pname = "go-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "cmd/${targetName}" ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        nativeBuildInputs = ([ pkgs.unzip ] ++ (if cgo.haveCgo then (cgo.cgoPkgs ++ [ pkgs.pkg-config ]) else []));
        configurePhase = mkConfigurePhase { inherit cgo; includeGoFlags = false; };
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = mkOverrides { patchesMap = patchesMap; devMap = devOverrides; };
      } else {}));
    in buildGoFn args;

  goLib = {
    name,
    modulesToml,
    devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [],
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    pkgConfigNames ? {},
    repoCgoPkgs ? [],
  }:
    let
      patchesMap = let
        scan = dir: H.patchesMapFromDir dir;
        merge = a: b: pkgs.lib.foldlAttrs (acc: k: v: acc // { "${k}" = (acc.${k} or []) ++ v; }) a b;
      in pkgs.lib.foldl' merge {} (map scan patchDirs);
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      cgo = mkCgoEnv { inherit nixCgoPkgs nixCgoAttrs repoCgoPkgs; };
      baseArgs = {
        pname = "golib-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "." ];
        doCheck = false;
        doInstallCheck = false;
        disallowedReferences = [];
        nativeBuildInputs = (if cgo.haveCgo then (cgo.cgoPkgs ++ [ pkgs.pkg-config ]) else []);
        configurePhase = mkConfigurePhase { inherit cgo; includeGoFlags = true; };
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = mkOverrides { patchesMap = patchesMap; devMap = H.readDevOverrides devOverrideEnv; };
      } else {}));
    in buildGoFn args;

  # Build a Go package as a C archive (.a) with an accompanying header via buildmode=c-archive
  goCArchive = {
    name,
    modulesToml,
    devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDir ? ../../patches/go,
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    repoCgoPkgs ? [],
  }:
    let
      patchesMap = H.patchesMapFromDir patchDir;
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      cgo = mkCgoEnv { inherit nixCgoPkgs nixCgoAttrs repoCgoPkgs; };
    in buildGoFn ({
      pname = "gocarchive-${H.sanitizeName name}";
      version = "0.1.0";
      src = srcAbs;
      modules = modulesToml;
      subPackages = [ "." ];
      doCheck = false;
      doInstallCheck = false;
      nativeBuildInputs = cgo.cgoPkgs ++ [ pkgs.unzip pkgs.pkg-config ];
      configurePhase = ''
        runHook preConfigure
        export GOCACHE=$TMPDIR/go-cache
        export GOPATH="$TMPDIR/go"
        export GOSUMDB=off
        export CGO_ENABLED=1
        export PKG_CONFIG_PATH=${cgo.pkgCfgPaths}
        if [ -z "$PKG_CONFIG_PATH" ]; then
          export CGO_CFLAGS="${cgo.synthCFlags} $CGO_CFLAGS"
          export CGO_LDFLAGS="${cgo.synthLdFlags} $CGO_LDFLAGS"
        fi
        runHook postConfigure
      '';
      buildPhase = ''
        runHook preBuild
        mkdir -p $out/lib $out/include
        # Build the c-archive for the package at subdir (".")
        # The output is a .a and a header named after the module/package
        pkgName=$(basename "$PWD")
        outA="$out/lib/lib''${pkgName}.a"
        outH="$out/include/''${pkgName}.h"
        go env -w GOFLAGS=-mod=mod >/dev/null 2>&1 || true
        go build -buildmode=c-archive -o "$outA" .
        # Locate the generated header (go writes a .h next to the .a)
        genH=$(dirname "$outA")/$(basename "$outA" .a).h
        if [ -f "$genH" ]; then
          cp -f "$genH" "$outH"
        else
          # Fallback: copy any generated header in build dir
          find . -maxdepth 1 -type f -name '*.h' -print -quit | xargs -I{} cp -f {} "$outH" 2>/dev/null || true
        fi
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        # Artifacts already copied to $out in buildPhase
        :
        runHook postInstall
      '';
    } // (if takesOverrides then {
      overrides = mkOverrides { patchesMap = patchesMap; devMap = H.readDevOverrides devOverrideEnv; };
    } else {}));
}


