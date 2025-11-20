{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
  clangxx = C.clangxx;
  llvmAr = C.llvmAr;
in {
  # Build a wasm32 static library from C/C++ sources under subdir of srcRoot.
  # - Uses clang/clang++ with --target=wasm32-unknown-unknown by default (no syscalls).
  # - Produces $out/lib/lib<sanitized>.a and installs headers to $out/include/**.
  # - Intended to be linked into a higher-level wasm artifact (e.g., TinyGo).
  cppWasmStaticLib = {
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
    wasmTarget ? "wasm32-unknown-unknown",
    # Optional WASI sysroot (used when wasmTarget == "wasm32-wasi")
    wasiSysroot ? null,
  }:
  let
    pname = "cppwasm-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    # Compute a sysroot path for WASI if available. Prefer explicit wasiSysroot, then pkgs.wasi-sdk,
    # then pkgs.wasi-libc (if it exposes a compatible sysroot layout). Otherwise, omit --sysroot.
    sysrootPath =
      if wasmTarget == "wasm32-wasi"
      then (
        if wasiSysroot != null then wasiSysroot else
        (if pkgs ? wasi-sdk then "${pkgs.wasi-sdk}/share/wasi-sysroot"
         else (if pkgs ? wasi-libc then (
           # Some nixpkgs expose include/lib under wasi-libc; try common layout
           # Most Clang builds accept a directory with include/lib as sysroot.
           "${pkgs.wasi-libc}"
         ) else null))
      )
      else null;
    sysrootArg = if sysrootPath != null then ("--sysroot=" + sysrootPath) else "";
    # Discover sources deterministically; include both C and C++ units.
    srcsCmd = if srcList != [] then (
      "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) + " | sort"
    ) else (
      "find ./src -type f \\( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' -o -name '*.c' \\) 2>/dev/null | sed 's#^./##' | sort"
    );
    # Use clang driver explicitly for C units to avoid accidental C++ name mangling.
    clang = "${pkgs.llvmPackages.clang-unwrapped}/bin/clang";
    clangxx_unwrapped = "${pkgs.llvmPackages.clang-unwrapped}/bin/clang++";
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
      # Avoid cc-wrapper injecting host-only flags that wasm32 doesn't support
      unset NIX_CFLAGS_COMPILE || true
      unset NIX_CFLAGS_LINK || true
      unset NIX_LDFLAGS || true
      export SOURCE_DATE_EPOCH=1
      mkdir -p "$out/lib" "$out/include"
      tmp="$TMPDIR/obj"; mkdir -p "$tmp"

      mapfile -t SRCS < <(${srcsCmd})
      mapfile -t HDRS < <(find . -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \) | sort)

      # Common flags: pure compute, no exceptions/RTTI, no host I/O
      cxxflags_common="--target=${wasmTarget} ${sysrootArg} -std=${std} -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-bounds-check -fvisibility=hidden -fno-asynchronous-unwind-tables -fno-unwind-tables -fno-omit-frame-pointer -g0 -O2 -pipe"
      cflags_common="--target=${wasmTarget} ${sysrootArg} -std=c11 -fvisibility=hidden -g0 -O2 -pipe"
      incFlags="${lib.concatStringsSep " " (map (p: "-I${p}") includes)}"
      defFlags="${lib.concatStringsSep " " (map (d: "-D${d}") defines)}"
      extraC="${lib.concatStringsSep " " (map (f: f) cflags)}"

      # Compile each source to an object in tmp preserving tree shape
      for s in "''${SRCS[@]}"; do
        rel="''${s#./}"
        obj="$tmp/''${rel%.*}.o"
        mkdir -p "$(dirname "$obj")"
        case "$s" in
          *.c)
            ${clang}   $cflags_common  $incFlags $defFlags $extraC -c "$s" -o "$obj"
            ;;
          *.cpp|*.cc|*.cxx)
            ${clangxx_unwrapped} $cxxflags_common $incFlags $defFlags $extraC -c "$s" -o "$obj"
            ;;
        esac
      done

      mapfile -t OBJS < <(find "$tmp" -type f -name '*.o' | sort)
      ${llvmAr} rcs "lib${H.sanitizeName name}.a" "''${OBJS[@]}"
      install -Dm644 "lib${H.sanitizeName name}.a" "$out/lib/lib${H.sanitizeName name}.a"

      for h in "''${HDRS[@]}"; do
        install -Dm644 "$h" "$out/include/''${h#./}"
      done

      : > "$out/build.log"
      echo "name=${name}" >> "$out/build.log"
      echo "wasmTarget=${wasmTarget}" >> "$out/build.log"
      ${if wasmTarget == "wasm32-wasi" then ''echo "sysroot=${sysrootArg}" >> "$out/build.log"'' else ""}
      echo "std=${std}" >> "$out/build.log"
      echo "includes=$incFlags" >> "$out/build.log"
      echo "defines=$defFlags" >> "$out/build.log"
      echo "cflags=$extraC" >> "$out/build.log"
      echo "sources=''${#SRCS[@]}" >> "$out/build.log"
      echo "objects=''${#OBJS[@]}" >> "$out/build.log"
    '';
  };
}


