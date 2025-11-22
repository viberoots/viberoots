{ pkgs }:
# tools/nix/uv2nix-adapter.nix
# Adapter facade intended to realize Python environments via uv2nix.
# For now, we implement a conservative, offline-friendly materializer that
# mirrors the stub backend semantics while exposing a "uv2nix" backend identity.
# When a proper uv2nix integration is available, the inner buildPhase should
# be replaced by a call into uv2nix to materialize site-packages deterministically.
args:
let
  lib = pkgs.lib;
  pname = args.pname or "py-unnamed";
  version = args.version or "0.0.0";
  src = args.srcAbs or args.src or ./.;
  lockfile = args.lockfile or null;
  subdir = args.subdir or ".";
  patchesMap = args.patchesMap or {};
  devOverrides = args.devOverrides or {};
  kind = args.kind or "app";
  wsRoot = args.wsRoot or null;
  groups = args.groups or [];

  testResolveJSON = builtins.getEnv "NIX_PY_TEST_RESOLVE_JSON";
  patchesMapFile = pkgs.writeText "py-patches.json" (builtins.toJSON patchesMap);
  devOverridesFile = pkgs.writeText "py-dev-overrides.json" (builtins.toJSON devOverrides);
  testResolveFile =
    if testResolveJSON != "" then pkgs.writeText "py-test-resolve.json" testResolveJSON
    else pkgs.writeText "py-test-resolve.json" "{}";

  py = pkgs.python3 or pkgs.python311;
in
pkgs.stdenvNoCC.mkDerivation {
  inherit pname version src;
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused pkgs.patch py ];

  buildPhase = ''
    set -euo pipefail
    if [ -d "${subdir}" ]; then
      cd "${subdir}"
    fi
    if [ ! -f "${lockfile}" ]; then
      # Prefer working tree lockfile for dev/test; fall back to src snapshot
      if [ -n "${wsRoot:-}" ] && [ -f "${wsRoot}/${subdir}/${lockfile}" ]; then
        cp "${wsRoot}/${subdir}/${lockfile}" "./${lockfile}"
      elif [ -f "${src}/${subdir}/${lockfile}" ]; then
        cp "${src}/${subdir}/${lockfile}" "./${lockfile}"
      elif [ -f "${src}/uv.lock" ]; then
        cp "${src}/uv.lock" "./${lockfile}"
      else
        echo "[uv2nix-adapter] missing lockfile: ${lockfile}" >&2
        exit 1
      fi
    fi

    mkdir -p "$TMPDIR/site"
    site="$TMPDIR/site"

    # Parse uv.lock minimally (offline)
    keysFile="$TMPDIR/keys.txt"
    : > "$keysFile"
    cur_name=""
    cur_ver=""
    while IFS= read -r line; do
      l="$(printf "%s" "$line" | sed -e 's/^[[:space:]]*//')"
      case "$l" in
        "[[package]]"*)
          if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then
            printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"
          fi
          cur_name=""
          cur_ver=""
          ;;
        name\ =\ \"*\" )
          cur_name="$(printf "%s" "$l" | sed -n 's/^name = "\(.*\)".*$/\1/p' | tr '[:upper:]' '[:lower:]')"
          ;;
        version\ =\ \"*\" )
          cur_ver="$(printf "%s" "$l" | sed -n 's/^version = "\(.*\)".*$/\1/p' | tr '[:upper:]' '[:lower:]')"
          ;;
      esac
    done < "${lockfile}"
    if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then
      printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"
    fi
    sort -u "$keysFile" -o "$keysFile"

    patchesMap='${patchesMapFile}'
    devOverrides='${devOverridesFile}'
    testResolve='${testResolveFile}'

    # Materialize each distribution into site using (in priority order):
    # devOverrides → testResolve origin → skip
    while IFS= read -r key; do
      [ -n "$key" ] || continue
      srcPath="$(${pkgs.jq}/bin/jq -r --arg k "$key" '.[$k] // empty' "$devOverrides")"
      if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
        dist="$(printf "%s" "$key" | sed 's/@.*$//')"
        wantVer="$(printf "%s" "$key" | sed 's/^.*@//')"
        origin="$(${pkgs.jq}/bin/jq -r --arg d "$dist" '.[$d].originPath // empty' "$testResolve")"
        ver="$(${pkgs.jq}/bin/jq -r --arg d "$dist" '.[$d].version // empty' "$testResolve")"
        if [ -n "$origin" ]; then
          cand1="$origin"
          cand2="${src}/$origin"
          cand3="${src}/${subdir}/$origin"
          cand4=""
          if [ -n "${wsRoot:-}" ]; then
            cand4="${wsRoot}/${subdir}/$origin"
          fi
          for c in "$cand1" "$cand2" "$cand3" "$cand4"; do
            if [ -n "$c" ] && [ -e "$c" ]; then
              origin="$c"
              break
            fi
          done
        fi
        if [ -n "$origin" ] && [ -e "$origin" ]; then
          if [ -z "$ver" ] || [ "$ver" = "$wantVer" ]; then
            srcPath="$origin"
          fi
        fi
      fi
      if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
        continue
      fi
      work="$TMPDIR/work-$(echo "$key" | tr '@' '_' | tr '/' '_')"
      mkdir -p "$work"
      cp -a "$srcPath"/. "$work"/
      chmod -R u+w "$work" || true
      # Apply patches if present
      ${pkgs.jq}/bin/jq -r --arg k "$key" '.[$k][]? // empty' "$patchesMap" | while IFS= read -r patchFile; do
        [ -n "$patchFile" ] || continue
        if [ -f "$patchFile" ]; then
          (cd "$work" && ${pkgs.patch}/bin/patch -p1 -t -N < "$patchFile")
        fi
      done
      # Copy layout into site
      pkgDirs="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
      if [ "$pkgDirs" = "1" ]; then
        d="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | head -n1)"
        cp -a "$d" "$site/"
      else
        cp -a "$work"/. "$site"/
      fi
    done < "$keysFile"
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out/site" "$out/bin"
    if [ -d "$TMPDIR/site" ]; then
      cp -R "$TMPDIR/site/." "$out/site/" || true
    fi
    wrapper="$out/bin/${pname}"
    cat > "$wrapper" <<'SH'
    #!/usr/bin/env bash
    set -euo pipefail
    HERE="$(cd "$(dirname "$0")" && pwd)"
    PY="$(command -v python3 || true)"
    if [ -z "$PY" ]; then PY="${py}/bin/python"; fi
    export PYTHONPATH="$HERE/../site:${src}/${subdir}/src''${PYTHONPATH:+:$PYTHONPATH}"
    if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -d "''${WORKSPACE_ROOT}/${subdir}/src" ]; then
      export PYTHONPATH="''${WORKSPACE_ROOT}/${subdir}/src''${PYTHONPATH:+:}''${PYTHONPATH}"
    fi
    MAIN="${src}/${subdir}/bin/__main__.py"
    if [ -f "$MAIN" ]; then
      exec "$PY" "$MAIN" "$@"
    fi
    if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -f "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" ]; then
      exec "$PY" "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" "$@"
    fi
    echo "python app entrypoint not found at $MAIN" >&2
    echo "PYTHONPATH=$PYTHONPATH" >&2
    exit 2
    SH
    chmod +x "$wrapper"

    cat > "$out/BUILD-INFO.json" <<JSON
    {
      "kind": "${kind}",
      "lockfile": "${lockfile}",
      "subdir": "${subdir}",
      "groups": ${builtins.toJSON groups},
      "backend": "uv2nix"
    }
    JSON
  '';
}


