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
  nixLibDirs = C.nixLibDirs;
  nixRpathFlags = C.nixRpathFlags;
  joinInc = C.joinInc;
  joinDef = C.joinDef;
  joinExtraC = C.joinExtraC;
  resolveAttrsToPkgs = C.resolveAttrsToPkgs;
  hasGTestAttr = C.hasGTestAttr;
  gtestPkgsAllFor = C.gtestPkgsAllFor;
in {
  # Build a GoogleTest-style test binary. Determinism: stable ordering and flags.
  cppTest = {
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
    nixCxxAttrNames ? nixCxxAttrs,
    nixpkgsProfile ? "default",
    srcList ? [],
    patches ? [],
  }:
  let
    pname = "cpptest-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    resolvedPkgs =
      let base = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
      in base ++ (if hasGTest then gtestPkgsAll else []);
    nixInc = nixIncFlags resolvedPkgs;
    nixLib = nixLibFlags resolvedPkgs;
    libDirs = nixLibDirs resolvedPkgs;
    rpathFlags = nixRpathFlags resolvedPkgs;
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC (cflags ++ [ "-ffunction-sections" "-fdata-sections" ]);
    extraLD  = joinExtraC ldflags;
    platLD   = if pkgs.stdenv.isDarwin then "-Wl,-dead_strip" else "-Wl,--gc-sections";
    # Heuristic: if gtest/googletest is among the original attr names, add test libs.
    hasGTest = hasGTestAttr nixCxxAttrNames;
    gtestLibs = if hasGTest then "-lgtest_main -lgtest" else "";
    gtestPkgsAll = if nixCxxAttrs == [] then nixCxxPkgs else gtestPkgsAllFor nixCxxAttrs;
    gtestInc = if hasGTest && (gtestPkgsAll != []) then (
      lib.concatStringsSep " " (map (p: "-isystem ${toIncludeBase p}/include") gtestPkgsAll)
    ) else "";
    gtestLibPath = if hasGTest && (gtestPkgsAll != []) then (
      lib.concatStringsSep " " (map (p: "-L${toLibBase p}/lib") gtestPkgsAll)
    ) else "";
    threadLib = if pkgs.stdenv.isDarwin then "" else "-pthread";
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
      set -eu
      mkdir -p "$out/bin" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      echo "[cpp.test] nixCxxAttrs=${lib.concatStringsSep "," nixCxxAttrs}" >&2
      echo "[cpp.test] nixpkgsProfile=${nixpkgsProfile}" >&2
      echo "[cpp.test] resolvedPkgs=${lib.concatStringsSep " " (map (p: toIncludeBase p) resolvedPkgs)}" >&2
      echo "[cpp.test] nixInc=${nixInc}" >&2
      echo "[cpp.test] gtestInc=${gtestInc}" >&2

      # Discover sources deterministically from working directory
      mapfile -t SRCS < <(find . -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) | sed 's#^\./##' | sort)
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc} ${gtestInc}"
      echo "[cpp.test] cflags_common=$cflags_common" >&2
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        obj="$tmp/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        ${clangxx} $cflags_common ${incFlags} ${defFlags} ${extraC} -c "$s" -o "$obj"
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      outbin="$out/bin/${H.sanitizeName name}"
      # Auto-discover static libraries from nix pkgs to link with -l<name>
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
      ${clangxx} ${platLD} ${nixLib} ${rpathFlags} ${gtestLibPath} ${extraLD} "''${OBJS[@]}" ${gtestLibs} ${threadLib} "''${LIBFLAGS[@]}" -o "$outbin"

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "nixpkgsProfile=${nixpkgsProfile}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "ldflags=${extraLD} ${platLD}" >> "$out/build.log"
      echo "nixLib=${nixLib}" >> "$out/build.log"
      echo "gtestLibs=${gtestLibs}" >> "$out/build.log"
      echo "link_libs=''${LIBFLAGS[*]}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
      echo "outbin=$outbin" >> "$out/build.log"
    '';
  };
}

