{ pkgs }:
let
  LH = import ./lib/lang-helpers.nix { inherit pkgs; };
in {
  inherit (LH)
    segs
    getAtPath
    resolveAttrFromPkgs
    sanitizeName
    patchesMapFromDir
    readDevOverrides
    guardNoDevOverridesInCI;

  /*
    mkOverrides — Compose Go module patch lists and dev src overrides.
    This helper mirrors the logic previously in templates/go.nix and is shared
    to keep template files focused and readable. Behavior is intentionally
    unchanged.
  */
  mkOverrides = { patchesMap, devMap }:
    (module: old:
      let
        mType = builtins.typeOf module;
        pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
        ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
        keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
        patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
        srcOverride =
          if builtins.hasAttr keyWithVer devMap
          then devMap.${keyWithVer}
          else (devMap.${pkg} or old.src);
      in old // {
        patches = (old.patches or []) ++ patchList;
        src = srcOverride;
      }
    );

  /*
    mkConfigurePhase — Shared configure/env phase for Go templates.
    Sets deterministic Go build env and configures CGO toolchain flags
    based on the resolved cgo inputs. Kept here to avoid duplication across
    goApp and goLib templates. Behavior is unchanged from the in-file version.
  */
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
}
