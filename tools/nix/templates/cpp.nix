{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  clangxx = "${pkgs.llvmPackages.clang}/bin/clang++";
  llvmAr  = "${pkgs.llvmPackages.llvm}/bin/llvm-ar";

  # Stable sort helper for lists of strings
  sorted = xs: lib.sort (a: b: a < b) xs;
  # Internal helpers (behavior-preserving; used by app/lib/test)
  joinInc = paths: lib.concatStringsSep " " (map (p: "-I${p}") (sorted paths));
  joinDef = defs: lib.concatStringsSep " " (map (d: "-D${d}") (sorted defs));
  joinExtraC = flags: lib.concatStringsSep " " (sorted flags);
in rec {
  toIncludeBase = p: if (builtins.isAttrs p && p ? dev) then p.dev else p;
  toLibBase = p: p; # libs typically live under the default output
  # Common flag joiners for nix pkgs include/lib paths (need access to toIncludeBase/toLibBase)
  nixIncFlags = pkgsList: lib.concatStringsSep " " (map (p: "-isystem ${toIncludeBase p}/include") pkgsList);
  nixLibFlags = pkgsList: lib.concatStringsSep " " (map (p: "-L${toLibBase p}/lib") pkgsList);
  # Resolve a dotted attribute path like "pkgs.gtest" against an attribute set
  getAtPath = attrs: parts:
    if parts == [] then attrs else (
      let k = lib.head parts; rest = lib.tail parts; in
        if (builtins.isAttrs attrs) && (builtins.hasAttr k attrs)
        then getAtPath (builtins.getAttr k attrs) rest
        else null
    );

  # Standardized dev override handling (shared helper)
  devMap = H.readDevOverrides "NIX_CPP_DEV_OVERRIDE_JSON";
  _ci_guard = H.guardNoDevOverridesInCI "NIX_CPP_DEV_OVERRIDE_JSON";

  normalizeAttr = s:
    let s0 = lib.toLower (lib.trim s);
        withPkgs = if lib.hasPrefix "pkgs." s0 then s0 else ("pkgs." + s0);
    in if withPkgs == "pkgs.gtest" then "pkgs.googletest" else withPkgs;

  # Split a dotted attribute path (e.g., "pkgs.foobar.baz")
  segs = s: let xs = lib.splitString "." s; in if xs == [] then [] else xs;

  # Resolve a string attribute against pkgs, handling gtest → googletest alias
  getAtFromPkgs = s:
    let parts0 = segs s;
        parts = if parts0 != [] && (lib.head parts0) == "pkgs" then lib.tail parts0 else parts0;
    in if parts == [ "gtest" ]
       then getAtPath pkgs [ "googletest" ]
       else getAtPath pkgs parts;

  overridePkgIfAny = attr: pkg:
    let key = normalizeAttr attr;
        # Accept keys both with and without pkgs. prefix
        keyAlt = lib.removePrefix "pkgs." key;
        has = builtins.hasAttr key devMap || builtins.hasAttr keyAlt devMap;
        path = if builtins.hasAttr key devMap then devMap.${key}
               else (devMap.${keyAlt} or null);
    in if has && path != null && path != ""
       then (pkg.overrideAttrs (old: {
         src = builtins.path path;
         pname = (old.pname or "pkg") + "-dev";
         version = "0.0.0-dev";
       }))
       else pkg;

  # Map a list of nixCxxAttrs strings to concrete pkgs values (with overrides)
  resolveAttrsToPkgs = nixCxxAttrs:
    builtins.filter (v: v != null) (map (a:
      let base = getAtFromPkgs a; in if base == null then null else overridePkgIfAny a base
    ) nixCxxAttrs);

  # gtest helpers used by cppTest
  hasGTestAttr = nixCxxAttrs: builtins.any (a: lib.hasInfix "googletest" a || lib.hasInfix "gtest" a) nixCxxAttrs;
  gtestPkgsAllFor = nixCxxAttrs:
    let
      direct = builtins.filter (p: p != null) [ (getAtFromPkgs "googletest") (getAtFromPkgs "gtest") ];
      fallback = []
        ++ (if (builtins.hasAttr "googletest" pkgs) then [ pkgs.googletest ] else [])
        ++ (if (builtins.hasAttr "gtest" pkgs) then [ pkgs.gtest ] else []);
    in if direct != [] then direct else fallback;

  cppApp = {
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
    srcList ? [],
    patches ? [],
  }:
  let
    pname = "cppapp-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    # Resolve nixCxxAttrs like "pkgs.gtest" into paths if provided at eval-time
    resolvedPkgs = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
    # include flags from explicit includes and resolved nixCxx packages
    nixInc = nixIncFlags resolvedPkgs;
    nixLib = nixLibFlags resolvedPkgs;
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC (cflags ++ [ "-ffunction-sections" "-fdata-sections" ]);
    extraLD  = joinExtraC ldflags;
    platLD   = if pkgs.stdenv.isDarwin then "-Wl,-dead_strip" else "-Wl,--gc-sections";
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (sorted srcList))) + " | sort"
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
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -eu
      mkdir -p "$out/bin" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      echo "[cpp.nix:app] nixCxxAttrs=${lib.concatStringsSep "," nixCxxAttrs}" >&2
      echo "[cpp.nix:app] nixInc=${nixInc}" >&2

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
      outbin="$out/bin/${H.sanitizeName name}"
      # Auto-discover static libraries from nix pkgs to link with -l<name>
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
      # Link resolved nix libraries first so -l flags can resolve
      ${clangxx} ${platLD} ${nixLib} ${extraLD} "''${OBJS[@]}" "''${LIBFLAGS[@]}" -o "$outbin"

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "ldflags=${extraLD} ${platLD}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
      echo "outbin=$outbin" >> "$out/build.log"
    '';
  };

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
    nixCxxPkgs ? [],
    nixCxxAttrs ? [],
    patches ? [],
  }:
  let
    pname = "cpplib-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    resolvedPkgs = nixCxxPkgs ++ (resolveAttrsToPkgs nixCxxAttrs);
    nixInc = nixIncFlags resolvedPkgs;
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC cflags;
    # Note: ldflags are reserved for future parity with cppApp; unused here.
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
      set -eu
      mkdir -p "$out/lib" "$out/include"

      tmp="$TMPDIR/obj"
      mkdir -p "$tmp"

      # Discover and sort sources/headers deterministically
      mapfile -t SRCS < <(find . -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) | sort)
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc}"
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

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
    '';
  };

  # Build a GoogleTest-style test binary. This mirrors cppApp but also links
  # against common test libraries when present. Determinism: stable ordering,
  # reproducible flags, and no ambient FS reads.
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
    incFlags = joinInc includes;
    defFlags = joinDef defines;
    extraC   = joinExtraC (cflags ++ [ "-ffunction-sections" "-fdata-sections" ]);
    extraLD  = joinExtraC ldflags;
    platLD   = if pkgs.stdenv.isDarwin then "-Wl,-dead_strip" else "-Wl,--gc-sections";
    # Heuristic: if gtest/googletest is among nixCxxAttrs, add -lgtest and -lgtest_main and force include/lib paths
    hasGTest = hasGTestAttr nixCxxAttrs;
    gtestLibs = if hasGTest then "-lgtest_main -lgtest" else "";
    gtestPkgsAll = gtestPkgsAllFor nixCxxAttrs;
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
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -eu
      mkdir -p "$out/bin" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      echo "[cpp.nix:test] nixCxxAttrs=${lib.concatStringsSep "," nixCxxAttrs}" >&2
      echo "[cpp.nix:test] resolvedPkgs=${lib.concatStringsSep " " (map (p: toIncludeBase p) resolvedPkgs)}" >&2
      echo "[cpp.nix:test] nixInc=${nixInc}" >&2
      echo "[cpp.nix:test] gtestInc=${gtestInc}" >&2

      # Discover sources deterministically from working directory
      mapfile -t SRCS < <(find . -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) | sed 's#^\./##' | sort)
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      cflags_common="-std=${std} -fno-record-gcc-switches -ffile-prefix-map=$PWD=. -g0 -O2 -pipe ${nixInc} ${gtestInc}"
      echo "[cpp.nix:test] cflags_common=$cflags_common" >&2
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
      ${clangxx} ${platLD} ${nixLib} ${gtestLibPath} ${extraLD} "''${OBJS[@]}" ${gtestLibs} ${threadLib} "''${LIBFLAGS[@]}" -o "$outbin"

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "std=${std}" >> "$out/build.log"
      echo "includes=${incFlags}" >> "$out/build.log"
      echo "defines=${defFlags}" >> "$out/build.log"
      echo "cflags=${extraC}" >> "$out/build.log"
      echo "ldflags=${extraLD} ${platLD}" >> "$out/build.log"
      echo "nixLib=${nixLib}" >> "$out/build.log"
      echo "gtestLibs=${gtestLibs}" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
      echo "outbin=$outbin" >> "$out/build.log"
    '';
  };
}


