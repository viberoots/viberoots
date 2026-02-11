{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
in {
  /*
    Build a C/C++ Emscripten bundle (JS + WASM) from sources under subdir of srcRoot.

    - Produces:
        $out/lib/<sanitized>.js
        $out/lib/<sanitized>.wasm
      and installs headers to:
        $out/include/**
    - Defaults target to Node (no browser globals) and keeps runtime minimal.
    - Asyncify/ports are OFF by default; can be toggled via extraFlags.
  */
  cppWasmEmscriptenLib = {
    name,
    srcRoot ? ../../..,
    subdir ? ".",
    nixCxxAttrs ? [],
    includes ? [],
    defines ? [],
    cflags ? [],
    std ? "c++17",
    srcList ? [],
    patches ? [],
    # Emscripten-specific options
    exportedFunctions ? [],
    extraFlags ? [],
  }:
  let
    pname = "cppems-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    # Artifact base name derived from sanitized name
    base = H.sanitizeName name;
    jsOut = "$out/lib/${base}.js";
    wasmOut = "$out/lib/${base}.wasm";

    # Resolve any nix-provided includes/libs (kept for parity with cpp templates)
    incFlags = C.nixIncFlags nixCxxAttrs + " " + (lib.concatStringsSep " " (map (p: "-I${p}") includes));
    defFlags = lib.concatStringsSep " " (map (d: "-D${d}") defines);
    extraC = lib.concatStringsSep " " cflags;

    # Turn exportedFunctions list into Emscripten -s EXPORTED_FUNCTIONS=["_sym", ...]
    exportedStr =
      let
        quoted = lib.concatStringsSep "," (map (f: "\\\"${f}\\\"" ) exportedFunctions);
      in "[${quoted}]";
    emcc = "${pkgs.emscripten}/bin/emcc";
    empp = "${pkgs.emscripten}/bin/em++";
    exportedFunctionsList = if builtins.isList exportedFunctions then exportedFunctions else [];
    exportedFunctionFlags =
      if exportedFunctionsList != []
      then [ "-s" "EXPORTED_FUNCTIONS=${exportedStr}" ]
      else [];
    # Minimal flags for Node + standalone wasm; modularized factory for clean import()
    emFlagsCommon = [
      "-O2"
      "-s" "STANDALONE_WASM=1"
      "--no-entry"
      "-s" "ENVIRONMENT=node"
      "-s" "MODULARIZE=1"
      "-s" "EXPORT_NAME=ModuleFactory"
    ] ++ exportedFunctionFlags ++ extraFlags;
    # When callers provide explicit exports, honor that exact list.
    # Otherwise export all defined symbols so generic C entrypoints remain callable.
    ldExports =
      if exportedFunctionsList != []
      then map (f:
        let nm = if lib.hasPrefix "_" f then lib.removePrefix "_" f else f;
        in "-Wl,--export=${nm}"
      ) exportedFunctionsList
      else [ "-Wl,--export-all" ];
    join = xs: lib.concatStringsSep " " xs;
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) + " | sort"
    ) else (
      "find ./src -type f \\( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' -o -name '*.c' \\) 2>/dev/null | sed 's#^./##' | sort"
    );
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    inherit patches;
    nativeBuildInputs = [ pkgs.emscripten pkgs.which ];
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    # Build directly in installPhase to keep phases minimal and deterministic
    installPhase = ''
      set -euo pipefail
      export SOURCE_DATE_EPOCH=1
      export EM_CACHE="$TMPDIR/emscripten-cache"
      mkdir -p "$out/lib" "$out/include" "$TMPDIR/obj" "$EM_CACHE"

      # Discover sources deterministically (Nix-computed command)
      mapfile -t SRCS < <(${srcsCmd})

      # Copy headers
      find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) -print0 \
        | xargs -0 -I{} sh -c 'install -Dm644 "{}" "$out/include/{}"'

      incFlags="${incFlags}"
      defFlags="${defFlags}"
      extraC="${extraC}"
      std="${std}"

      # Compile each source unit to .o under $TMPDIR/obj
      for s in "''${SRCS[@]}"; do
        [ -n "$s" ] || continue
        rel="$s"
        obj="$TMPDIR/obj/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        case "$s" in
          *.c)
            ${emcc} -std=c11 $incFlags $defFlags $extraC -c "$s" -o "$obj"
            ;;
          *.cpp|*.cc|*.cxx)
            ${empp} -std=$std $incFlags $defFlags $extraC -c "$s" -o "$obj"
            ;;
        esac
      done

      mapfile -t OBJS < <(find "$TMPDIR/obj" -type f -name '*.o' | sort)
      # Link JS + WASM bundle
      ${emcc} ${join (emFlagsCommon ++ ldExports)} "''${OBJS[@]}" -o "${jsOut}"

      # Ensure outputs exist
      test -f "${jsOut}" && test -f "${wasmOut}"

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "out_js=${jsOut}" >> "$out/build.log"
      echo "out_wasm=${wasmOut}" >> "$out/build.log"
      echo "exported=${exportedStr}" >> "$out/build.log"
    '';
  };
}


