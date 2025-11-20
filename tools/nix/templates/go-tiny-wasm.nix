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
    # Go package directory relative to srcRoot (e.g., "libs/math-api")
    subdir ? ".",
    # gomod2nix lockfile path for the module (unused by TinyGo but kept for parity)
    modulesToml ? null,
    # Package-local patch directories (unused here; retained for interface parity)
    patchDirs ? [],
    # List of derivations produced by cppWasmStaticLib (optional)
    wasmStaticLibs ? [],
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
      # Make C/C++ headers visible if provided
      export CGO_CFLAGS="${cIncludeFlags} $CGO_CFLAGS"
      export CGO_LDFLAGS="${ldPathFlags} $CGO_LDFLAGS"
      runHook postConfigure
    '';
    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      export GOMODCACHE="${GOMODCACHE:-$TMPDIR/gomodcache}"
      mkdir -p "$out/lib" "$out/include"
      # Copy headers from provided wasm static libs for downstream consumers (optional)
      ${lib.concatStringsSep "\n" (map (p: ''if [ -d "${p}/include" ]; then cp -R "${p}/include/." "$out/include/"; fi'') wasmStaticLibs)}
      # Build the TinyGo module; keep it pure compute for portability
      # Note: we do not require symbol references to C/C++ at this stage.
      tinygo build \
        -o "$out/lib/top.wasm" \
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
      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "subdir=${subdir}" >> "$out/build.log"
      echo "wasmStaticLibs=${toString (builtins.length wasmStaticLibs)}" >> "$out/build.log"
      echo "target=${target}" >> "$out/build.log"
      echo "opt=${optimize}" >> "$out/build.log"
      echo "panic=${panicMode}" >> "$out/build.log"
      echo "scheduler=${scheduler}" >> "$out/build.log"
      runHook postInstall
    '';
  };
}


