{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
  clang = C.clang;
  clangxx = C.clangxx;
  nixIncFlags = C.nixIncFlags;
  joinInc = C.joinInc;
  joinDef = C.joinDef;
  joinExtraC = C.joinExtraC;
  resolveAttrsToPkgs = C.resolveAttrsToPkgs;
  llvmAr = C.llvmAr;
in {
  # Build a static C++ library from sources under subdir of srcRoot.
  # Determinism: stable file ordering, stable flag ordering, reproducible flags.
  cppLib = {
    name,
    srcRoot ? ../../..,
    subdir ? ".",
    includes ? [],
    defines ? [],
    cflags ? [],
    ldflags ? [],
    std ? "c++17",
    stl ? "libc++",
    compilerIdentity ? builtins.toString pkgs.llvmPackages.clang,
    targetTriple ? "",
    nixCxxPkgs ? [],
    nixCxxAttrs ? [],
    nixpkgsProfile ? "default",
    srcList ? [],
    patches ? [],
  }:
  let
    _contract = if compilerIdentity != builtins.toString pkgs.llvmPackages.clang then
      builtins.throw "cpp library requires compiler_identity from the selected pinned LLVM toolchain"
      else if !builtins.elem std [ "c11" "c++17" ] then
        builtins.throw "cpp library requires c11 or c++17"
      else if (std == "c11") != (stl == "none") then
        builtins.throw "cpp library requires c11/none or c++17/libc++"
      else true;
    targetFlag = lib.optionalString (targetTriple != "") "--target=${targetTriple}";
    stlFlag = lib.optionalString (stl == "libc++") "-stdlib=libc++";
    pname = "cpplib-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    resolvedPkgs = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
    nixInc = nixIncFlags resolvedPkgs;
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC cflags;
    # Note: ldflags are reserved for future parity with cppApp; unused here.
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) +
      " | grep -E '\\.(c|cc|cpp|cxx)$' | sort"
    ) else (
      # Fallback: restrict to conventional source dir to avoid picking up tests/** by accident
      "find ./src -type f \\( -name '*.c' -o -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \\) 2>/dev/null | sed 's#^./##' | sort"
    );
  in assert _contract; pkgs.stdenv.mkDerivation {
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
      set -eu
      mkdir -p "$out/lib" "$out/include"

      tmp="$TMPDIR/obj"
      mkdir -p "$tmp"

      # Discover and sort sources/headers deterministically
      mapfile -t SRCS < <(${srcsCmd})
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} ${stlFlag} ${targetFlag} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc}"
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        key="''${rel%.*}"
        key="''${key//\//__}"
        key="''${key//[^A-Za-z0-9_]/_}"
        obj="$tmp/''${key}.o"
        compiler=${clangxx}; unit_flags="$cflags_common"
        case "$s" in *.c) compiler=${clang}; unit_flags="-std=c11 ${targetFlag} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc}" ;; *) [ "${std}" = "c++17" ] || { echo "c11 target cannot compile C++ source $s" >&2; exit 2; } ;; esac
        "$compiler" $unit_flags ${incFlags} ${defFlags} ${extraC} -c "$s" -o "$obj"
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      ${llvmAr} rcs "lib${H.sanitizeName name}.a" "''${OBJS[@]}"
      install -Dm644 "lib${H.sanitizeName name}.a" "$out/lib/lib${H.sanitizeName name}.a"

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
      echo "stl=${stl}" >> "$out/build.log"
      echo "compilerIdentity=${compilerIdentity}" >> "$out/build.log"
      echo "targetTriple=${targetTriple}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
    '';
  };
}
