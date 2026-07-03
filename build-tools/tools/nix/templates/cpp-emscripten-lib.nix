{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
in {
  cppWasmEmscriptenLib = {
    name,
    srcRoot ? ../../..,
    subdir ? ".",
    nixCxxPkgs ? [],
    nixCxxAttrs ? [],
    nixpkgsProfile ? "default",
    includes ? [],
    defines ? [],
    cflags ? [],
    std ? "c++17",
    srcList ? [],
    patches ? [],
    exportedFunctions ? [],
    extraFlags ? [],
  }:
  let
    pname = "cppems-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    base = H.sanitizeName name;
    jsOut = "$out/lib/${base}.js";
    wasmOut = "$out/lib/${base}.wasm";
    resolvedPkgs = nixCxxPkgs ++ (C.resolveAttrsToPkgs nixCxxAttrs);
    incFlags = C.nixIncFlags resolvedPkgs + " " + (lib.concatStringsSep " " (map (p: "-I${p}") includes));
    defFlags = lib.concatStringsSep " " (map (d: "-D${d}") defines);
    extraC = lib.concatStringsSep " " cflags;
    exportedStr =
      let
        quoted = lib.concatStringsSep "," (map (f: "\\\"${f}\\\"" ) exportedFunctions);
      in "[${quoted}]";
    emcc = "${pkgs.emscripten}/bin/emcc";
    empp = "${pkgs.emscripten}/bin/em++";
    emscriptenCacheSeed = pkgs.runCommand "emscripten-cache-seed-${pkgs.emscripten.version}" {
      nativeBuildInputs = [ pkgs.emscripten pkgs.which ];
    } ''
      set -euo pipefail
      export HOME="$TMPDIR/home"
      export EM_CACHE="$TMPDIR/emscripten-cache"
      mkdir -p "$HOME" "$EM_CACHE"
      cat > "$TMPDIR/seed.cc" <<'EOF'
      extern "C" int emscripten_cache_seed() { return 0; }
      EOF
      "${pkgs.emscripten}/bin/em++" \
        -O2 \
        -s STANDALONE_WASM=1 \
        --no-entry \
        -s ENVIRONMENT=node \
        -s MODULARIZE=1 \
        -s EXPORT_NAME=ModuleFactory \
        "$TMPDIR/seed.cc" \
        -o "$TMPDIR/seed.js"
      mkdir -p "$out"
      cp -a "$EM_CACHE/." "$out"/
    '';
    exportedFunctionsList = if builtins.isList exportedFunctions then exportedFunctions else [];
    exportedFunctionFlags =
      if exportedFunctionsList != []
      then [ "-s" "EXPORTED_FUNCTIONS=${exportedStr}" ]
      else [];
    verboseFlags =
      let
        raw = builtins.getEnv "VBR_CPP_EMSCRIPTEN_VERBOSE";
      in if raw == "1" || raw == "true" then [ "-v" ] else [];
    emFlagsCommon = [
      "-O2"
      "-s" "STANDALONE_WASM=1"
      "--no-entry"
      "-s" "ENVIRONMENT=node"
      "-s" "MODULARIZE=1"
      "-s" "EXPORT_NAME=ModuleFactory"
    ] ++ exportedFunctionFlags ++ extraFlags ++ verboseFlags;
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
    installPhase = ''
      set -euo pipefail
      export SOURCE_DATE_EPOCH=1
      export EM_CACHE="$TMPDIR/emscripten-cache"
      diagnosticsDir="$out/diagnostics/emscripten"
      phaseLog="$diagnosticsDir/phase-times.tsv"
      compileLog="$diagnosticsDir/compile-times.tsv"
      commandsLog="$diagnosticsDir/commands.txt"
      sourceLog="$diagnosticsDir/source-list.txt"
      mkdir -p "$out/lib" "$out/include" "$TMPDIR/obj" "$EM_CACHE" "$diagnosticsDir"
      printf 'phase\tseconds\n' > "$phaseLog"
      printf 'language\tseconds\tsource\tobject\tbytes\n' > "$compileLog"
      : > "$commandsLog"
      : > "$sourceLog"
      phase_done() {
        printf '%s\t%s\n' "$1" "$2" >> "$phaseLog"
      }
      count_files() {
        find "$1" -type f 2>/dev/null | wc -l | tr -d ' '
      }
      size_kb() {
        du -sk "$1" 2>/dev/null | awk '{print $1}'
      }
      SECONDS=0
      cache_seed_start=$SECONDS
      cp -a ${emscriptenCacheSeed}/. "$EM_CACHE"/
      chmod -R u+w "$EM_CACHE"
      cache_seed_secs=$((SECONDS - cache_seed_start))
      phase_done em_cache_seed_copy "$cache_seed_secs"
      em_cache_seed_files="$(count_files "$EM_CACHE")"
      em_cache_seed_kb="$(size_kb "$EM_CACHE")"

      src_discovery_start=$SECONDS
      mapfile -t SRCS < <(${srcsCmd})
      src_discovery_secs=$((SECONDS - src_discovery_start))
      phase_done source_discovery "$src_discovery_secs"
      printf '%s\n' "''${SRCS[@]}" > "$sourceLog"
      src_count="''${#SRCS[@]}"
      if [ "$src_count" -eq 0 ]; then
        echo "cpp-emscripten-lib: no compile sources discovered under $PWD" >&2
        exit 2
      fi

      header_copy_start=$SECONDS
      find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) -print0 \
        | xargs -0 -I{} sh -c 'install -Dm644 "{}" "$out/include/{}"'
      header_copy_secs=$((SECONDS - header_copy_start))
      phase_done header_copy "$header_copy_secs"
      header_count="$(count_files "$out/include")"

      incFlags="${incFlags}"
      defFlags="${defFlags}"
      extraC="${extraC}"
      std="${std}"
      {
        echo "toolchain=${pkgs.emscripten}"
        echo "nixpkgsProfile=${nixpkgsProfile}"
        echo "emcc=${emcc}"
        echo "empp=${empp}"
        echo "incFlags=$incFlags"
        echo "defFlags=$defFlags"
        echo "extraC=$extraC"
        echo "std=$std"
        echo "linkFlags=${join (emFlagsCommon ++ ldExports)}"
      } >> "$commandsLog"

      compile_total_secs=0
      for s in "''${SRCS[@]}"; do
        [ -n "$s" ] || continue
        rel="$s"
        obj="$TMPDIR/obj/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        case "$s" in
          *.c)
            compile_start=$SECONDS
            echo "compile.c $s -> $obj" >> "$commandsLog"
            ${emcc} -std=c11 $incFlags $defFlags $extraC -c "$s" -o "$obj"
            compile_secs=$((SECONDS - compile_start))
            ;;
          *.cpp|*.cc|*.cxx)
            compile_start=$SECONDS
            echo "compile.cxx $s -> $obj" >> "$commandsLog"
            ${empp} -std=$std $incFlags $defFlags $extraC -c "$s" -o "$obj"
            compile_secs=$((SECONDS - compile_start))
            ;;
          *)
            continue
            ;;
        esac
        compile_total_secs=$((compile_total_secs + compile_secs))
        obj_bytes="$(wc -c < "$obj" | tr -d ' ')"
        case "$s" in
          *.c) lang=c ;;
          *) lang=cxx ;;
        esac
        printf '%s\t%s\t%s\t%s\t%s\n' "$lang" "$compile_secs" "$s" "$obj" "$obj_bytes" >> "$compileLog"
      done
      phase_done compile_total "$compile_total_secs"

      object_list_start=$SECONDS
      mapfile -t OBJS < <(find "$TMPDIR/obj" -type f -name '*.o' | sort)
      object_list_secs=$((SECONDS - object_list_start))
      phase_done object_list "$object_list_secs"
      object_count="''${#OBJS[@]}"
      object_total_bytes="$(find "$TMPDIR/obj" -type f -name '*.o' -print0 | xargs -0 wc -c 2>/dev/null | awk 'END{print $1+0}')"
      link_start=$SECONDS
      echo "link ${join (emFlagsCommon ++ ldExports)} -> ${jsOut}" >> "$commandsLog"
      ${emcc} ${join (emFlagsCommon ++ ldExports)} "''${OBJS[@]}" -o "${jsOut}"
      link_secs=$((SECONDS - link_start))
      phase_done link "$link_secs"
      test -f "${jsOut}" && test -f "${wasmOut}"
      total_secs=$SECONDS
      phase_done total "$total_secs"
      out_js_bytes="$(wc -c < "${jsOut}" | tr -d ' ')"
      out_wasm_bytes="$(wc -c < "${wasmOut}" | tr -d ' ')"
      em_cache_final_files="$(count_files "$EM_CACHE")"
      em_cache_final_kb="$(size_kb "$EM_CACHE")"

      {
        echo "name=${name}"
        echo "toolchain=${pkgs.emscripten}"
        echo "out_js=${jsOut}"
        echo "out_wasm=${wasmOut}"
        echo "exported=${exportedStr}"
        echo "src_count=$src_count"
        echo "header_count=$header_count"
        echo "object_count=$object_count"
        echo "object_total_bytes=$object_total_bytes"
        echo "out_js_bytes=$out_js_bytes"
        echo "out_wasm_bytes=$out_wasm_bytes"
        echo "em_cache_seed_files=$em_cache_seed_files"
        echo "em_cache_seed_kb=$em_cache_seed_kb"
        echo "em_cache_final_files=$em_cache_final_files"
        echo "em_cache_final_kb=$em_cache_final_kb"
        echo "source_discovery_secs=$src_discovery_secs"
        echo "header_copy_secs=$header_copy_secs"
        echo "compile_total_secs=$compile_total_secs"
        echo "link_secs=$link_secs"
        echo "total_secs=$total_secs"
        echo "phase_log=$phaseLog"
        echo "compile_log=$compileLog"
        echo "commands_log=$commandsLog"
        echo "source_log=$sourceLog"
      } > "$out/build.log"
    '';
  };
}
