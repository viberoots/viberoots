{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  DevOverrideEnvs = import ../lib/dev-override-envs.nix { inherit pkgs; };
  Common = import ../templates-common.nix { inherit pkgs; };
  Tiny = import ./go-tiny-wasm.nix { inherit pkgs; };

  buildGoFn = if pkgs ? buildGoApplication then pkgs.buildGoApplication
              else builtins.throw "gomod2nix overlay (buildGoApplication) is required; no vendoring fallback";
  takesOverrides = (builtins.hasAttr "overrides" (builtins.functionArgs (pkgs.buildGoApplication)));

  mkCgoEnv = { nixCgoPkgs ? [], nixCgoAttrs ? [], repoCgoPkgs ? [] }:
    let
      resolvedCgo = builtins.filter (v: v != null) (map H.resolveAttrFromPkgs nixCgoAttrs);
      pkgCfgPkgs = nixCgoPkgs ++ resolvedCgo;
      cgoPkgs = pkgCfgPkgs ++ repoCgoPkgs;
      haveCgo = (builtins.length cgoPkgs) > 0;
      pkgCfgPaths = lib.concatStringsSep ":" (map (p: "${p}/lib/pkgconfig") pkgCfgPkgs);
      synthCFlags = lib.concatStringsSep " " (map (p: "-I${p}/include") cgoPkgs);
      synthLdFlags = lib.concatStringsSep " " (map (p: "-L${p}/lib") cgoPkgs);
      repoStaticLibs = lib.concatStringsSep " " (map (p: let a = "${p}/lib"; in ''$(ls -1 "${a}" 2>/dev/null | sed -n 's/^lib\(.*\)\.a$/-l\1/p' | tr '\n' ' ')'') repoCgoPkgs);
    in {
      inherit cgoPkgs haveCgo pkgCfgPaths synthCFlags synthLdFlags repoStaticLibs;
    };

in {
  goApp = {
    name,
    modulesToml,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "go",
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
      patchesMap = H.patchesMapFromDirsWith { dirs = patchDirs; };
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
        # Shared configure/env phase imported from templates-common.nix
        configurePhase = Common.mkConfigurePhase { inherit cgo; includeGoFlags = false; };
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = Common.mkOverrides { patchesMap = patchesMap; devMap = devOverrides; };
      } else {}));
    in buildGoFn args;

  goLib = {
    name,
    modulesToml,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "go",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [],
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    pkgConfigNames ? {},
    repoCgoPkgs ? [],
  }:
    let
      patchesMap = H.patchesMapFromDirsWith { dirs = patchDirs; };
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
        # Shared configure/env phase imported from templates-common.nix
        configurePhase = Common.mkConfigurePhase { inherit cgo; includeGoFlags = true; };
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = Common.mkOverrides { patchesMap = patchesMap; devMap = H.readDevOverrides devOverrideEnv; };
      } else {}));
    in buildGoFn args;

  goTest = {
    name,
    modulesToml,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "go",
    devOverridesMap ? {},
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [],
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    repoCgoPkgs ? [],
    srcList ? [],
  }:
    let
      patchesMap = H.patchesMapFromDirsWith { dirs = patchDirs; };
      devOverridesFromEnv = H.readDevOverrides devOverrideEnv;
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      devOverrides = (devOverridesMap // devOverridesFromEnv);
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      cgo = mkCgoEnv { inherit nixCgoPkgs nixCgoAttrs repoCgoPkgs; };
      testDirs =
        let
          testSrcs = builtins.filter (s: lib.hasSuffix "_test.go" s) (if srcList == null then [] else srcList);
          dirOf = s: let parts = lib.splitString "/" s; in if (builtins.length parts) > 1 then lib.concatStringsSep "/" (lib.init parts) else ".";
          uniq = xs: builtins.attrNames (builtins.listToAttrs (map (d: { name = d; value = true; }) xs));
          dirs = uniq (map dirOf testSrcs);
        in if (builtins.length dirs) > 0 then dirs else [ "." ];
      dirList = lib.concatStringsSep " " (map (d: "\"${d}\"") testDirs);
      baseArgs = {
        pname = "gotest-${H.sanitizeName name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        subPackages = [ "." ];
        doCheck = false;
        doInstallCheck = false;
        allowGoReference = true;
        disallowedReferences = [];
        nativeBuildInputs = (if cgo.haveCgo then (cgo.cgoPkgs ++ [ pkgs.pkg-config ]) else []);
        configurePhase = Common.mkConfigurePhase { inherit cgo; includeGoFlags = true; };
      };
      args = baseArgs // ({
        pwd = srcAbs;
        modRoot = ".";
      } // (if takesOverrides then {
        overrides = Common.mkOverrides { patchesMap = patchesMap; devMap = devOverrides; };
      } else {}));
    in buildGoFn (args // {
      buildPhase = ''
        runHook preBuild
        mkdir -p "$TMPDIR/go-test-bins"
        for d in ${dirList}; do
          if [ "$d" = "." ]; then
            go test -c -o "$TMPDIR/go-test-bins"
          else
            go test -c -o "$TMPDIR/go-test-bins" "./$d"
          fi
        done
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p "$out/bin" "$out/tests"
        cp -f "$TMPDIR/go-test-bins/"*.test "$out/tests/"
        runner="$out/bin/${H.sanitizeName name}"
        cat > "$runner" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for t in "$ROOT/tests"/*.test; do
  if [ -x "$t" ]; then "$t"; fi
done
EOF
        chmod +x "$runner"
        runHook postInstall
      '';
    });

  # Build a Go package as a C archive (.a) with an accompanying header via buildmode=c-archive
  goCArchive = {
    name,
    modulesToml,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "go",
    subdir ? ".",
    pkgPath ? ".",
    srcRoot ? ../../..,
    patchDirs ? null,
    patchDir ? ../../patches/go,
    nixCgoPkgs ? [],
    nixCgoAttrs ? [],
    repoCgoPkgs ? [],
  }:
    let
      patchDirsResolved = if patchDirs != null then patchDirs else [ patchDir ];
      patchesMap = H.patchesMapFromDirsWith { dirs = patchDirsResolved; };
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
      cgo = mkCgoEnv { inherit nixCgoPkgs nixCgoAttrs repoCgoPkgs; };
      # Base name of the Go package directory (e.g., "demo-go"); used to expose a stable header alias.
      subdirBase = builtins.baseNameOf (builtins.toString subdir);
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
        if [ "${pkgPath}" = "." ]; then
          pkgName=$(basename "$PWD")
        else
          pkgName=$(basename "${pkgPath}")
        fi
        outA="$out/lib/lib''${pkgName}.a"
        outH="$out/include/''${pkgName}.h"
        go env -w GOFLAGS=-mod=mod >/dev/null 2>&1 || true
        go build -buildmode=c-archive -o "$outA" ${pkgPath}
        # Locate the generated header (go writes a .h next to the .a)
        genH=$(dirname "$outA")/$(basename "$outA" .a).h
        if [ -f "$genH" ]; then
          cp -f "$genH" "$outH"
        else
          # Fallback: copy any generated header in build dir
          find . -maxdepth 1 -type f -name '*.h' -print -quit | xargs -I{} cp -f {} "$outH" 2>/dev/null || true
        fi
        # Compatibility: also expose a header named after the Go package directory (e.g., demo-go.h)
        if [ -f "$outH" ] && [ "${subdirBase}" != "$pkgName" ]; then
          cp -f "$outH" "$out/include/${subdirBase}.h"
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
      overrides = Common.mkOverrides { patchesMap = patchesMap; devMap = H.readDevOverrides devOverrideEnv; };
    } else {}));
  # Re-export TinyGo wasm builder from dedicated template
  inherit (Tiny) goTinyWasmLib;
}

