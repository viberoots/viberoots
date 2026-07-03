{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
  clangxx = C.clangxx;
  nixIncFlags = C.nixIncFlags;
  nixLibFlags = C.nixLibFlags;
  nixLibDirs = C.nixLibDirs;
  nixRpathFlags = C.nixRpathFlags;
  joinInc = C.joinInc;
  joinDef = C.joinDef;
  joinExtraC = C.joinExtraC;
  resolveAttrsToPkgs = C.resolveAttrsToPkgs;
in {
  # Build a shared C++ library from sources under subdir of srcRoot.
  # Determinism: stable file ordering, stable flag ordering, reproducible flags.
  cppSharedLib = {
    name,
    srcRoot ? ../../..,
    subdir ? ".",
    includes ? [],
    defines ? [],
    cflags ? [],
    ldflags ? [],
    std ? "c++17",
    nixCxxPkgs ? [],
    nixCxxAttrs ? [],
    nixpkgsProfile ? "default",
    srcList ? [],
    patches ? [],
  }:
  let
    pname = "cxxshared-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    resolvedPkgs = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
    nixInc = nixIncFlags resolvedPkgs;
    nixLib = nixLibFlags resolvedPkgs;
    libDirs = nixLibDirs resolvedPkgs;
    rpathFlags = nixRpathFlags resolvedPkgs;
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC (cflags ++ [ "-fPIC" ]);
    extraLD  = joinExtraC ldflags;
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) +
      " | grep -E '\\.(c|cc|cpp|cxx)$' | sort"
    ) else (
      # Fallback: restrict to conventional source dir to avoid picking up tests/** by accident
      "find ./src -type f \\( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \\) 2>/dev/null | sed 's#^./##' | sort"
    );
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    inherit patches;
    nativeBuildInputs = [ pkgs.llvmPackages.clang pkgs.llvmPackages.llvm ];
    buildInputs = resolvedPkgs;
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -euo pipefail
      export SOURCE_DATE_EPOCH=1
      mkdir -p "$out/lib" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      echo "[cpp.shared-lib] nixCxxAttrs=${lib.concatStringsSep "," nixCxxAttrs}" >&2
      echo "[cpp.shared-lib] nixpkgsProfile=${nixpkgsProfile}" >&2
      echo "[cpp.shared-lib] nixInc=${nixInc}" >&2

      mapfile -t SRCS < <(${srcsCmd})
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc}"
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        obj="$tmp/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        ${clangxx} $cflags_common ${incFlags} ${defFlags} ${extraC} -c "$s" -o "$obj"
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      outso="$out/lib/lib${H.sanitizeName name}.so"
      outdylib="$out/lib/lib${H.sanitizeName name}.dylib"

      declare -a PKG_LIB_DIRS
      PKG_LIB_DIRS=(
        ${lib.concatStringsSep " " libDirs}
      )
      declare -a LIBFLAGS
      declare -A SEEN_LIBS
      for d in "''${PKG_LIB_DIRS[@]}"; do
        if [ -d "$d" ]; then
          while IFS= read -r f; do
            b=$(basename "$f")
            n="''${b#lib}"
            n="''${n%.a}"
            n="''${n%.so}"
            n="''${n%.dylib}"
            if [ -z "''${SEEN_LIBS[$n]-}" ]; then
              SEEN_LIBS[$n]=1
              LIBFLAGS+=("-l$n")
            fi
          done < <(find "$d" -maxdepth 1 -type f \( -name 'lib*.a' -o -name 'lib*.so' -o -name 'lib*.dylib' \) 2>/dev/null | sort)
        fi
      done

      if ${if pkgs.stdenv.isDarwin then "true" else "false"}; then
        ${clangxx} -dynamiclib ${nixLib} ${rpathFlags} ${extraLD} "''${OBJS[@]}" "''${LIBFLAGS[@]}" -o "$outdylib"
        ln -s "lib${H.sanitizeName name}.dylib" "$outso"
      else
        ${clangxx} -shared ${nixLib} ${rpathFlags} ${extraLD} "''${OBJS[@]}" "''${LIBFLAGS[@]}" -o "$outso"
      fi

      for h in "''${HDRS[@]}"; do
        rel="''${h#./}"
        if [[ "$rel" == include/* ]]; then
          dest="$out/include/''${rel#include/}"
        else
          dest="$out/include/$rel"
        fi
        install -Dm644 "$h" "$dest"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "nixpkgsProfile=${nixpkgsProfile}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "ldflags=${extraLD}" >> "$out/build.log"
      echo "link_libs=''${LIBFLAGS[*]}" >> "$out/build.log"
      echo "outso=$outso" >> "$out/build.log"
    '';
  };
}
