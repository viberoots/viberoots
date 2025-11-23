{ pkgs, uv2nixLib ? null }:
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

  # Prefer uv2nix-backed realization unless explicitly disabled or a test-only
  # resolve mapping is provided (which requires the stub materializer). Also
  # fall back to stub when uv2nixLib is not provided by the caller.
  stubFlag = (builtins.getEnv "NIX_PY_USE_STUB_BACKEND") == "1";
  hasTestResolve = testResolveJSON != "";
  # Testing-only: allow a simple JSON mapping of dist -> {version, originPath}
  # injected at eval time to avoid network fetches. Empty by default.
  testResolveJSON = builtins.getEnv "NIX_PY_TEST_RESOLVE_JSON";
  patchesMapFile = pkgs.writeText "py-patches.json" (builtins.toJSON patchesMap);
  devOverridesFile = pkgs.writeText "py-dev-overrides.json" (builtins.toJSON devOverrides);
  testResolveFile =
    if testResolveJSON != "" then pkgs.writeText "py-test-resolve.json" testResolveJSON
    else pkgs.writeText "py-test-resolve.json" "{}";

  sanitize = s: lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;
  py = pkgs.python3 or pkgs.python311;
  uvMeta = if uv2nixLib != null then (uv2nixLib.meta or { version = "unknown"; rev = "unknown"; }) else { version = "unknown"; rev = "unknown"; };
  # Stable primary path: use stub when requested or when uv2nixLib is absent.
  useStub = stubFlag || (uv2nixLib == null);
  Uv2nixAdapter = if useStub then null else import ../../../uv2nix-adapter.nix { inherit pkgs; uv2nixLib = uv2nixLib; };
in
if (!useStub) then
  # Route through the adapter (uv2nix-backed realization)
  Uv2nixAdapter {
    inherit pname version kind wsRoot groups;
    srcAbs = src;
    lockfile = lockfile;
    subdir = subdir;
    patchesMap = patchesMap;
    devOverrides = devOverrides;
  }
else
pkgs.stdenvNoCC.mkDerivation {
  inherit pname version src;
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused pkgs.patch py ];

  buildPhase = ''
    set -euo pipefail
    if [ -d "${subdir}" ]; then
      cd "${subdir}"
    fi
    echo "[uv-backend] pwd=$(pwd)" >&2
    echo "[uv-backend] tree (top-level):" >&2
    (ls -la . || true) >&2
    if [ ! -f "${lockfile}" ]; then
      # Fallback for tests/dev: try live workspace, then original src snapshot
      if [ -n "${wsRoot:-}" ] && [ -f "${wsRoot}/${subdir}/${lockfile}" ]; then
        cp "${wsRoot}/${subdir}/${lockfile}" "./${lockfile}"
      elif [ -f "${src}/${subdir}/${lockfile}" ]; then
        cp "${src}/${subdir}/${lockfile}" "./${lockfile}"
      elif [ -f "${src}/uv.lock" ]; then
        cp "${src}/uv.lock" "./${lockfile}"
      else
        echo "missing lockfile: ${lockfile}" >&2
        exit 1
      fi
    fi
    mkdir -p "$TMPDIR/site"
    site="$TMPDIR/site"

    # Parse uv.lock minimally: collect name@version keys (lowercased)
    echo "[uv-backend] reading lockfile: ${lockfile}" >&2
    (sed -n '1,120p' "${lockfile}" || true) >&2
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

    # Tests: if uv.lock provided no keys, derive them from testResolve JSON
    if [ ! -s "$keysFile" ] && [ -f '${testResolveFile}' ]; then
      ${pkgs.jq}/bin/jq -r 'keys[] as $k | "\($k)@\(.[$k].version // "0.0.0")"' '${testResolveFile}' > "$keysFile" || true
      sort -u "$keysFile" -o "$keysFile"
    fi

    # Load maps
    patchesMap='${patchesMapFile}'
    devOverrides='${devOverridesFile}'
    testResolve='${testResolveFile}'
    echo "[uv-backend] patchesMap json:" >&2
    (cat "$patchesMap" || true) >&2
    echo "[uv-backend] devOverrides json:" >&2
    (cat "$devOverrides" || true) >&2

    jqget() { ${pkgs.jq}/bin/jq -r "$1" 2>/dev/null || true; }

    # For each key, materialize a distribution under site/, preferring devOverrides,
    # then testResolve, then skipping if no source is available. Apply any patches.
    while IFS= read -r key; do
      [ -n "$key" ] || continue
      # dev override
      srcPath="$(${pkgs.jq}/bin/jq -r --arg k "$key" '.[$k] // empty' "$devOverrides")"
      if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
        # test resolve mapping: {"dist":{"version":"1.0.0","originPath":"..."}}
        dist="$(printf "%s" "$key" | sed 's/@.*$//')"
        wantVer="$(printf "%s" "$key" | sed 's/^.*@//')"
        origin="$(${pkgs.jq}/bin/jq -r --arg d "$dist" '.[$d].originPath // empty' "$testResolve")"
        ver="$(${pkgs.jq}/bin/jq -r --arg d "$dist" '.[$d].version // empty' "$testResolve")"
        # Resolve origin relative to PWD, src root, subdir, or wsRoot if provided
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
      # Fallback: common vendor layout under the importer root
      if [ -z "$srcPath" ] && [ -d "vendor/''${dist}-''${wantVer}" ]; then
        srcPath="vendor/''${dist}-''${wantVer}"
      fi
      echo "[uv-backend] materialize key=$key dist=$dist wantVer=$wantVer origin=$origin ver=$ver srcPath=$srcPath" >&2
      # If still empty, skip (no available source for this distribution)
      if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
        echo "[uv-backend] skip key=$key — no srcPath" >&2
        continue
      fi
      work="$TMPDIR/work-$(echo "$key" | tr '@' '_' | tr '/' '_')"
      mkdir -p "$work"
      cp -a "$srcPath"/. "$work"/
      chmod -R u+w "$work" || true
      # Apply patches if present
      echo "[uv-backend] patches for $key:" >&2
      ${pkgs.jq}/bin/jq -r --arg k "$key" '.[$k][]? // empty' "$patchesMap" | while IFS= read -r patchFile; do
        [ -n "$patchFile" ] || continue
        if [ -f "$patchFile" ]; then
          echo "  apply: $patchFile" >&2
          tmpPatch="$TMPDIR/$(basename "$patchFile")"
          cp -f "$patchFile" "$tmpPatch" || true
          # Normalize CRLF → LF and expand minimal @@ hunks
          ${pkgs.gnused}/bin/sed -i $'s/\r$//' "$tmpPatch" || true
          ${pkgs.gnused}/bin/sed -E -i 's/^@@$/@@ -1,999 +1,999 @@/' "$tmpPatch" || true
          if ! (cd "$work" && ${pkgs.patch}/bin/patch -p1 -t -N -i "$tmpPatch"); then
            echo "[uv-backend] patch failed; attempting simple replacement fallback" >&2
            target="$(grep -E '^--- a/' "$tmpPatch" | head -n1 | ${pkgs.gnused}/bin/sed -E 's|^--- a/||')"
            if [ -n "$target" ] && [ -f "$work/$target" ]; then
              oldBlock="$TMPDIR/old.$$"
              newBlock="$TMPDIR/new.$$"
              ${pkgs.gnused}/bin/sed -n '1,/^@@/d; /^\-/p' "$tmpPatch" | ${pkgs.gnused}/bin/sed 's/^-//' > "$oldBlock"
              ${pkgs.gnused}/bin/sed -n '1,/^@@/d; /^\+/p' "$tmpPatch" | ${pkgs.gnused}/bin/sed 's/^+//' > "$newBlock"
              ${py}/bin/python - "$work/$target" "$oldBlock" "$newBlock" <<'PY'
import sys
fp, oldf, newf = sys.argv[1], sys.argv[2], sys.argv[3]
with open(oldf, "r", encoding="utf-8") as f:
    old = f.read()
with open(newf, "r", encoding="utf-8") as f:
    new = f.read()
with open(fp, "r", encoding="utf-8") as f:
    data = f.read()
data = data.replace(old, new)
with open(fp, "w", encoding="utf-8") as f:
    f.write(data)
PY
            fi
          fi
        else
          echo "  missing: $patchFile" >&2
        fi
      done
      # Install to site: prefer packages laid out as dir/<__init__.py>
      # If the top-level contains a single directory, treat that as the package root.
      pkgDirs="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
      if [ "$pkgDirs" = "1" ]; then
        d="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | head -n1)"
        cp -a "$d" "$site/"
      else
        # Fallback: copy entire work into site; Python will import via PYTHONPATH
        cp -a "$work"/. "$site"/
      fi
    done < "$keysFile"
    echo "[uv-backend] keys:" >&2
    cat "$keysFile" >&2
    echo "[uv-backend] site listing:" >&2
    (find "$site" -maxdepth 2 -type f -print || true) >&2
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out/site" "$out/bin"
    # Copy materialized site
    if [ -d "$TMPDIR/site" ]; then
      cp -R "$TMPDIR/site/." "$out/site/" || true
    fi
    # Minimal wrapper for apps: run Python with PYTHONPATH including site + src/<pkg>
    # Require a conventional __main__.py under bin/ for apps; no fallback masking.
    wrapper="$out/bin/${pname}"
    cat > "$wrapper" <<'SH'
    #!/usr/bin/env bash
    set -euo pipefail
    HERE="$(cd "$(dirname "$0")" && pwd)"
    PY="$(command -v python3 || true)"
    if [ -z "$PY" ]; then PY="${py}/bin/python"; fi
    export PYTHONPATH="$HERE/../site:${src}/${subdir}/src''${PYTHONPATH:+:$PYTHONPATH}"
    # Prefer live workspace source when available to enable dev/test flows
    if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -d "''${WORKSPACE_ROOT}/${subdir}/src" ]; then
      export PYTHONPATH="''${WORKSPACE_ROOT}/${subdir}/src''${PYTHONPATH:+:}''${PYTHONPATH}"
    fi
    MAIN="${src}/${subdir}/bin/__main__.py"
    if [ -f "$MAIN" ]; then
      exec "$PY" "$MAIN" "$@"
    fi
    # Fallback to live workspace entrypoint during dev/tests
    if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -f "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" ]; then
      exec "$PY" "''${WORKSPACE_ROOT}/${subdir}/bin/__main__.py" "$@"
    fi
    echo "python app entrypoint not found at $MAIN" >&2
    echo "PYTHONPATH=$PYTHONPATH" >&2
    exit 2
    SH
    chmod +x "$wrapper"
    # Record minimal metadata for debugging and cache keys
    cat > "$out/BUILD-INFO.json" <<JSON
    {
      "kind": "${kind}",
      "lockfile": "${lockfile}",
      "subdir": "${subdir}",
      "groups": ${builtins.toJSON groups},
      "backend": "stub",
      "uv2nix": ${builtins.toJSON uvMeta}
    }
    JSON
  '';
}

