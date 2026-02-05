{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
in {
  /*
    Build a TinyGo WebAssembly module for a Go package and emit a single `top.wasm`.

    - Intended for browser-style, bare wasm32 builds (no WASI).
    - Optionally accepts C/C++ wasm static libraries (from cppWasmStaticLib) to make
      their headers and archives available during the build. Linking these archives
      is optional for the initial TinyGo flow; the exported Go API can be pure.
  */
  goTinyWasmLib = {
    name,
    # Repository root (absolute, typically provided by the planner)
    srcRoot ? ../../..,
    # Go package directory relative to srcRoot (e.g., "projects/libs/math-api")
    subdir ? ".",
    # gomod2nix lockfile path for the module (unused by TinyGo but kept for parity)
    modulesToml ? null,
    # Package-local patch directories (unused here; retained for interface parity)
    patchDirs ? [],
    # List of derivations produced by cppWasmStaticLib (optional)
    wasmStaticLibs ? [],
    # For determinism diagnostics (planner-provided; not used for building)
    wasmStaticLibLabels ? [],
    # For determinism diagnostics (planner-provided; not used for building)
    linkClosureOverridesSummary ? "",
    # Build options
    # TinyGo target: "wasm" (bare) or "wasi" (WASI single-artifact backend)
    target ? "wasm",
    optimize ? "2",          # TinyGo -opt level (0,1,2 or "z" for size)
    panicMode ? "trap",      # TinyGo -panic mode (trap|print|external)
    scheduler ? "none",      # TinyGo -scheduler (none|tasks)
  }:
  let
    pname = "gotinywasm-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    # Aggregate library/include search paths from provided wasm static libs
    libDirs = map (d: "${d}/lib") wasmStaticLibs;
    incDirs = map (d: "${d}/include") wasmStaticLibs;
    numWasmStaticLibs = builtins.length wasmStaticLibs;
    ldPathFlags = lib.concatStringsSep " " (map (p: "-L" + p) libDirs);
    cIncludeFlags = lib.concatStringsSep " " (map (p: "-I" + p) incDirs);
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    # TinyGo toolchain and LLVM are sufficient for bare wasm builds
    nativeBuildInputs = [ pkgs.tinygo pkgs.llvmPackages.lld pkgs.llvmPackages.clang ];
    dontStrip = true;
    doCheck = false;
    dontConfigure = true;
    dontInstallCheck = true;
    # Keep the environment deterministic and minimal
    configurePhase = ''
      runHook preConfigure
      export HOME="$TMPDIR"
      export GOCACHE="$TMPDIR/go-cache"
      export GOPATH="$TMPDIR/go"
      export GOMODCACHE="$TMPDIR/gomodcache"
      export GOSUMDB=off
      export CGO_ENABLED=1
      # Make C/C++ headers visible if provided
      export CGO_CFLAGS="${cIncludeFlags} $CGO_CFLAGS"
      export CGO_CPPFLAGS="${cIncludeFlags} $CGO_CPPFLAGS"
      # Link all provided wasm static archives deterministically (closure order, per-lib stable order).
      # TinyGo consumes CGO_LDFLAGS, so we can pass full archive paths without requiring per-callsite cgo directives.
      extraArchives=""
      for d in ${lib.concatStringsSep " " (map (p: ''"${p}"'') wasmStaticLibs)}; do
        if [ -d "$d/lib" ]; then
          shopt -s nullglob
          for a in "$d/lib"/*.a; do
            extraArchives="$extraArchives $a"
          done
          shopt -u nullglob
        fi
      done
      export CGO_LDFLAGS="${ldPathFlags} $extraArchives $CGO_LDFLAGS"
      runHook postConfigure
    '';
    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      export GOMODCACHE="${GOMODCACHE:-$TMPDIR/gomodcache}"
      export CGO_ENABLED=1
      outTmp="$TMPDIR/out"
      mkdir -p "$outTmp/lib" "$outTmp/include"
      # Copy headers from provided wasm static libs for downstream consumers (optional)
      for d in ${lib.concatStringsSep " " (map (p: ''"${p}"'') wasmStaticLibs)}; do
        if [ -d "$d/include" ]; then
          # Avoid `cp -R` because it preserves directory perms from `/nix/store` (often 0555),
          # which can make the destination tree read-only and break subsequent copies.
          # Instead, copy files one-by-one with fresh destination dirs and stable perms.
          while IFS= read -r -d "" f; do
            rel="''${f#./}"
            install -Dm644 "$d/include/$rel" "$outTmp/include/$rel"
          done < <(cd "$d/include" && find . -type f -print0 | sort -z)
        fi
      done
      if [ "${toString numWasmStaticLibs}" -gt 0 ]; then
        firstHeader="$(find "$outTmp/include" -type f -print -quit 2>/dev/null || true)"
        if [ -z "$firstHeader" ]; then
          echo "goTinyWasmLib(${name}): expected headers from wasmStaticLibs, but none were copied" >&2
          exit 2
        fi
      fi
      extraArchives=""
      for d in ${lib.concatStringsSep " " (map (p: ''"${p}"'') wasmStaticLibs)}; do
        if [ -d "$d/lib" ]; then
          shopt -s nullglob
          for a in "$d/lib"/*.a; do
            extraArchives="$extraArchives $a"
          done
          shopt -u nullglob
        fi
      done
      # TinyGo does not reliably thread CGO_* env vars into its CGo clang invocation.
      # Instead, generate a tiny Go file that injects deterministic `#cgo` directives.
      pkgName="$(grep -R --include='*.go' -h -m1 -E '^package[[:space:]]+[A-Za-z0-9_]+' . | awk '{print $2}' || true)"
      if [ -z "$pkgName" ]; then
        echo "goTinyWasmLib(${name}): could not determine Go package name (no 'package ...' found)" >&2
        exit 2
      fi
      cat > bnx_cgo_flags.go <<EOF
// Code generated by bucknix (go-tiny-wasm.nix). DO NOT EDIT.
package $pkgName

/*
#cgo CFLAGS: -I$outTmp/include ${cIncludeFlags}
#cgo LDFLAGS: ${ldPathFlags} $extraArchives
*/
import "C"
EOF
      # Build the TinyGo module; keep it pure compute for portability
      # Note: we do not require symbol references to C/C++ at this stage.
      tinygo build \
        -o "$outTmp/lib/top.wasm" \
        -target ${target} \
        -no-debug \
        -panic ${panicMode} \
        -scheduler ${scheduler} \
        -opt ${optimize} \
        .
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      outTmp="$TMPDIR/out"
      mkdir -p "$out/lib" "$out/include"
      if [ -d "$outTmp/include" ]; then cp -R "$outTmp/include/." "$out/include/"; fi
      if [ -f "$outTmp/lib/top.wasm" ]; then cp -f "$outTmp/lib/top.wasm" "$out/lib/top.wasm"; fi
      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "subdir=${subdir}" >> "$out/build.log"
      echo "wasmStaticLibs=${toString (builtins.length wasmStaticLibs)}" >> "$out/build.log"
      echo "wasmStaticLibLabels=${lib.concatStringsSep "," wasmStaticLibLabels}" >> "$out/build.log"
      echo "linkClosureOverrides=${linkClosureOverridesSummary}" >> "$out/build.log"
      echo "target=${target}" >> "$out/build.log"
      echo "opt=${optimize}" >> "$out/build.log"
      echo "panic=${panicMode}" >> "$out/build.log"
      echo "scheduler=${scheduler}" >> "$out/build.log"
      runHook postInstall
    '';
  };
}


