{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
  clangxx = C.clangxx;
  toIncludeBase = C.toIncludeBase;
  toLibBase = C.toLibBase;
  nixIncFlags = C.nixIncFlags;
  nixLibFlags = C.nixLibFlags;
  joinInc = C.joinInc;
  joinDef = C.joinDef;
  joinExtraC = C.joinExtraC;
  resolveAttrsToPkgs = C.resolveAttrsToPkgs;
in {
  # Build a Node-API (.node) addon as a shared library.
  # Deterministic, minimal flags; cross-platform for Darwin/Linux.
  cppNodeAddon = {
    name,
    addonName ? name,
    srcRoot ? ../../..,
    subdir ? ".",
    includes ? [],
    defines ? [],
    cflags ? [],
    ldflags ? [],
    std ? "c++17",
    nixCxxPkgs ? [],
    nixCxxAttrs ? [],
    srcList ? [],
    patches ? [],
  }:
  let
    pname = "cppnode-addon-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    resolvedPkgs = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
    nixInc = nixIncFlags resolvedPkgs;
    nixLib = nixLibFlags resolvedPkgs;
    nodeInc = "-isystem ${C.nodeToolchain}/include/node";
    incFlags = joinInc includes;
    # Ensure NODE_GYP_MODULE_NAME and a default NAPI version are defined for compatibility.
    defFlags = joinDef (defines ++ [
      "NODE_GYP_MODULE_NAME=${addonName}"
      "NAPI_VERSION=8"
    ]);
    extraC   = joinExtraC (cflags ++ [ "-ffunction-sections" "-fdata-sections" "-fPIC" ]);
    extraLD  = joinExtraC ldflags;
    platLDGC = if pkgs.stdenv.isDarwin then "-Wl,-dead_strip" else "-Wl,--gc-sections";
    # On macOS, build a -dynamiclib with undefined symbols resolved at runtime by Node.
    # On Linux, build a -shared .so renamed to .node.
    linkCmdDarwin = ''
      ${clangxx} -dynamiclib -undefined dynamic_lookup ${platLDGC} ${nixLib} ${extraLD} "''${OBJS[@]}" "''${LIBFLAGS[@]}" -o "$outmod"
    '';
    linkCmdLinux = ''
      ${clangxx} -shared ${platLDGC} ${nixLib} ${extraLD} "''${OBJS[@]}" "''${LIBFLAGS[@]}" -o "$outmod"
    '';
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) + " | sort"
    ) else (
      # Conventional discovery: look under ./src for C/C++ sources
      "find ./src -type f \\( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' -o -name '*.c' \\) 2>/dev/null | sed 's#^./##' | sort"
    );
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    inherit patches;
    nativeBuildInputs = [ pkgs.llvmPackages.clang pkgs.llvmPackages.llvm ];
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -euo pipefail
      export SOURCE_DATE_EPOCH=1
      mkdir -p "$out/lib" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      echo "[cpp.node-addon] nixCxxAttrs=${lib.concatStringsSep "," nixCxxAttrs}" >&2
      echo "[cpp.node-addon] nixInc=${nixInc}" >&2
      echo "[cpp.node-addon] nodeInc=${nodeInc}" >&2

      mapfile -t SRCS < <(${srcsCmd})
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc} ${nodeInc}"
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        obj="$tmp/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        ${clangxx} $cflags_common ${incFlags} ${defFlags} ${extraC} -c "$s" -o "$obj"
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      outmod="$out/lib/${H.sanitizeName addonName}.node"

      # Auto-discover static libraries from nix packages to link with -l<name>
      declare -a PKG_LIB_DIRS
      PKG_LIB_DIRS=(
        ${lib.concatStringsSep " " (map (p: ("${toLibBase p}/lib")) resolvedPkgs)}
      )
      declare -a LIBFLAGS
      for d in "''${PKG_LIB_DIRS[@]}"; do
        if [ -d "$d" ]; then
          while IFS= read -r f; do
            b=$(basename "$f")
            n="''${b#lib}"
            n="''${n%.a}"
            LIBFLAGS+=("-l$n")
          done < <(find "$d" -maxdepth 1 -type f -name 'lib*.a' 2>/dev/null)
        fi
      done

      ${if pkgs.stdenv.isDarwin then linkCmdDarwin else linkCmdLinux}

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "addonName=${addonName}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "ldflags=${extraLD} ${platLDGC}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
      echo "outmod=$outmod" >> "$out/build.log"
    '';
  };
}


