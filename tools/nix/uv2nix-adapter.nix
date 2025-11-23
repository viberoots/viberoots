{ pkgs, uv2nixLib ? null }:
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
  # Resolve relative origins against BUCK_TEST_SRC or WORKSPACE_ROOT; fallback to flake root
  flakeRoot = builtins.toString ./.;
  buckTestSrc = builtins.getEnv "BUCK_TEST_SRC";
  workspaceEnv = builtins.getEnv "WORKSPACE_ROOT";
  originRoot = if buckTestSrc != "" then buckTestSrc else if workspaceEnv != "" then workspaceEnv else flakeRoot;

  testResolveJSON = builtins.getEnv "NIX_PY_TEST_RESOLVE_JSON";
  patchesMapFile = pkgs.writeText "py-patches.json" (builtins.toJSON patchesMap);
  devOverridesFile = pkgs.writeText "py-dev-overrides.json" (builtins.toJSON devOverrides);
  testResolveFile =
    if testResolveJSON != "" then pkgs.writeText "py-test-resolve.json" testResolveJSON
    else pkgs.writeText "py-test-resolve.json" "{}";
  # For the uv2nix primary path, embed workspace origins into the store so builds are pure/offline.
  testResolveObj =
    let raw = if testResolveJSON != "" then (builtins.fromJSON testResolveJSON) else {};
        names = builtins.attrNames raw;
        isRepoAbs = p: lib.hasPrefix "apps/" p || lib.hasPrefix "libs/" p || lib.hasPrefix "/" p;
        toStore = p: builtins.toString (builtins.path { path = builtins.toPath p; name = "uv-src"; });
        step = acc: name:
          let entry = raw.${name};
              ver = entry.version or null;
              origin = entry.originPath or null;
              storeOrigin =
                if origin == null then null else (
                  if isRepoAbs origin then toStore (originRoot + "/" + origin) else toStore (builtins.toString src + "/" + origin)
                );
              value = if storeOrigin != null then ({ version = ver; originPath = storeOrigin; })
                      else if origin != null then ({ version = ver; originPath = origin; })
                      else ({ version = ver; });
          in acc // { "${name}" = value; };
    in builtins.foldl' step {} names;

  py = pkgs.python3 or pkgs.python311;
  stubFlag = (builtins.getEnv "NIX_PY_USE_STUB_BACKEND") == "1";
  # Require uv2nix when not explicitly in stub mode
  _ = if (!stubFlag) && (uv2nixLib == null)
      then builtins.throw "uv2nix adapter requires uv2nixLib; set NIX_PY_USE_STUB_BACKEND=1 to force stub"
      else null;
in
# Primary path: call uv2nixLib to realize the environment (no silent fallbacks).
if (!stubFlag) then
  let
    uvDrv = uv2nixLib.mkEnv {
      inherit src subdir lockfile devOverrides wsRoot;
      # PR-2: delegate patching to uv2nix; pass patchesMap and testResolve as structured inputs.
      patchesMap = patchesMap;
      testResolve = testResolveObj;
    };
    meta = uv2nixLib.meta or { version = "unknown"; rev = "unknown"; };
  in
  pkgs.stdenvNoCC.mkDerivation {
    inherit pname version src;
    nativeBuildInputs = [ pkgs.coreutils pkgs.jq pkgs.git pkgs.gnused pkgs.patch py ];

    installPhase = ''
      set -euo pipefail
      mkdir -p "$out/site" "$out/bin"
      if [ -d "${uvDrv}/site" ]; then
        cp -R "${uvDrv}/site/." "$out/site/" || true
      fi
      chmod -R u+w "$out/site" || true
      # Compute minimal patches list (key+file basenames) in deterministic order (for introspection only)
      patchesJson="$(${pkgs.jq}/bin/jq -c 'to_entries | sort_by(.key) | [ .[] | .key as $k | (.value // []) | sort | .[] | {key:$k, file:(. | split(\"/\") | last)} ]' '${patchesMapFile}' 2>/dev/null || echo '[]')"
      wrapper="$out/bin/${pname}"
      {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo 'HERE="$(cd "$(dirname "$0")" && pwd)"'
        echo 'PY="$(command -v python3 || true)"'
        echo 'if [ -z "$PY" ]; then PY="${py}/bin/python"; fi'
        echo 'export PYTHONPATH="$HERE/../site:${src}/${subdir}/src''${PYTHONPATH:+:$PYTHONPATH}"'
        echo 'if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -d "''${WORKSPACE_ROOT}/${subdir}/src" ]; then'
        echo '  export PYTHONPATH="''${WORKSPACE_ROOT}/${subdir}/src''${PYTHONPATH:+:}''${PYTHONPATH}"'
        echo 'fi'
        echo 'MAIN="${src}/${subdir}/bin/__main__.py"'
        echo 'if [ -f "$MAIN" ]; then'
        echo '  exec "$PY" "$MAIN" "$@"'
        echo 'fi'
        echo 'if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -f "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" ]; then'
        echo '  exec "$PY" "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" "$@"'
        echo 'fi'
        echo 'echo "python app entrypoint not found at $MAIN" >&2'
        echo 'echo "PYTHONPATH=$PYTHONPATH" >&2'
        echo 'exit 2'
      } > "$wrapper"
      chmod +x "$wrapper"
      # Write minimal BUILD-INFO.json (avoid heredoc to prevent delimiter pitfalls)
      {
        echo '{'
        echo '  "kind": "'"${kind}"'",'
        echo '  "lockfile": "'"${lockfile}"'",'
        echo '  "subdir": "'"${subdir}"'",'
        printf '%s\n' "  \"groups\": ${builtins.toJSON groups},"
        printf '%s\n' "  \"patches\": ''${patchesJson},"
        echo '  "backend": "uv2nix",'
        echo '  "uv2nix": { "version": "'"${meta.version or "unknown"}"'", "rev": "'"${meta.rev or "unknown"}"'" }'
        echo '}'
      } > "$out/BUILD-INFO.json"
    '';
  }
else
pkgs.stdenvNoCC.mkDerivation {
  inherit pname version src;
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused pkgs.patch pkgs.git py ];

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
          cur_name="$(printf "%s" "$l" | sed -n 's/^name = \"\(.*\)\".*$/\1/p' | tr '[:upper:]' '[:lower:]')"
          ;;
        version\ =\ \"*\" )
          cur_ver="$(printf "%s" "$l" | sed -n 's/^version = \"\(.*\)\".*$/\1/p' | tr '[:upper:]' '[:lower:]')"
          ;;
      esac
    done < "${lockfile}"
    if [ -n "$cur_name" ] && [ -n "$cur_ver" ] ; then
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
        cp -a "$work"/. "$site/"
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


