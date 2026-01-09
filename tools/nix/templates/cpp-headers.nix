{ pkgs }:
let
  C = import ./cpp-common.nix { inherit pkgs; };
  lib = C.lib;
  H = C.H;
in {
  # Build a header-only C++ package from headers under subdir of srcRoot.
  # Artifact contract:
  # - $out/include contains the header tree (prefer ./include as the root when present)
  cppHeaders = {
    name,
    srcRoot ? ../../..,
    subdir ? ".",
    srcList ? [],
    patches ? [],
  }:
  let
    pname = "cppheaders-${H.sanitizeName name}";
    srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
    hdrsCmd =
      if srcList != [] then (
        "printf '%s\\n' " + (lib.concatStringsSep " " (map (s: "'" + s + "'") (lib.sort (a: b: a < b) srcList))) +
        " | grep -E '\\.(h|hpp|hh|hxx)$' | sort"
      ) else (
        "if [ -d ./include ]; then " +
        "  find ./include -type f \\( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \\) | sed 's#^\\./##' | sort; " +
        "else " +
        "  find . -type f \\( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \\) | sed 's#^\\./##' | sort; " +
        "fi"
      );
  in pkgs.stdenv.mkDerivation {
    inherit pname;
    version = "0.1.0";
    src = srcAbs;
    inherit patches;
    dontStrip = true;
    dontConfigure = true;
    dontInstallCheck = true;
    doCheck = false;
    installPhase = ''
      set -eu
      mkdir -p "$out/include"

      mapfile -t HDRS < <(${hdrsCmd})
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
      echo "headers=''${#HDRS[@]}" >> "$out/build.log"
    '';
  };
}


