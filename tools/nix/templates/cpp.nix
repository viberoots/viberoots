{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  clangxx = "${pkgs.llvmPackages.clang}/bin/clang++";
  llvmAr  = "${pkgs.llvmPackages.llvm}/bin/llvm-ar";

  # Stable sort helper for lists of strings
  sorted = xs: lib.sort (a: b: a < b) xs;
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
  }:
  let
    pname = "cpplib-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    incFlags = lib.concatStringsSep " " (map (p: "-I${p}") (sorted includes));
    defFlags = lib.concatStringsSep " " (map (d: "-D${d}") (sorted defines));
    extraC   = lib.concatStringsSep " " (sorted cflags);
    # Note: ldflags are reserved for future parity with cppApp; unused here.
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    nativeBuildInputs = [ pkgs.llvmPackages.clang pkgs.llvmPackages.llvm ];
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -eu
      mkdir -p "$out/lib" "$out/include"

      tmp="$TMPDIR/obj"
      mkdir -p "$tmp"

      # Discover and sort sources/headers deterministically
      mapfile -t SRCS < <(find . -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) | sort)
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe"
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        obj="$tmp/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        ${clangxx} $cflags_common ${incFlags} ${defFlags} ${extraC} -c "$s" -o "$obj"
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      ${llvmAr} rcs "lib${H.sanitizeName name}.a" "''${OBJS[@]}"
      install -Dm644 "lib${H.sanitizeName name}.a" "$out/lib/lib${H.sanitizeName name}.a"

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      {
        echo "name=${name}"
        echo "std=${std}"
        echo "includes=${incFlags}"
        echo "defines=${defFlags}"
        echo "cflags=${extraC}"
        echo "sources=${#SRCS[@]}"
        echo "objects=${#OBJS[@]}"
      } > "$out/build.log"
    '';
  };
}


