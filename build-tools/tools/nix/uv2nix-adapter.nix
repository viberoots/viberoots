{ pkgs, uv2nixLib ? null }:
# build-tools/tools/nix/uv2nix-adapter.nix
# Adapter facade intended to realize Python environments via uv2nix.
# For now, we implement a conservative, offline-friendly materializer that
# mirrors the stub backend semantics while exposing a "uv2nix" backend identity.
# When a proper uv2nix integration is available, the inner buildPhase should
# be replaced by a call into uv2nix to materialize site-packages deterministically.
args:
let
  lib = pkgs.lib;
  inputs = import ./uv2nix-inputs.nix { inherit lib pkgs args; };
  overlays = import ./uv2nix-overlays.nix { inherit lib; siteOverlays = inputs.siteOverlays; };
  env = import ./uv2nix-env.nix { inherit pkgs uv2nixLib; inputs = inputs; };
  py = pkgs.python3 or pkgs.python311;
  _ = if (uv2nixLib == null)
      then builtins.throw "uv2nix adapter requires uv2nixLib"
      else null;
  _lockfileRequired =
    if inputs.lockfile == null || inputs.lockfile == ""
    then builtins.throw "uv2nix adapter requires lockfile"
    else null;
in
# Primary path: call uv2nixLib to realize the environment (no silent fallbacks).

  let
    uvDrv = env.uvDrv;
    _uv2nixLibOk =
      if uv2nixLib == null then builtins.throw "uv2nix adapter requires uv2nixLib"
      else if !(builtins.isAttrs uv2nixLib) then builtins.throw "uv2nix adapter: uv2nixLib must be an attrset"
      else if !(uv2nixLib ? mkEnv) then builtins.throw "uv2nix adapter: uv2nixLib.mkEnv missing"
      else null;
    meta = env.meta;
  in
  pkgs.stdenvNoCC.mkDerivation {
    inherit (inputs) pname version src;
    passthru = {
      uv2nixEnv = uvDrv;
      srcForUv2nixEnv = env.srcForUv2nixEnv;
    };
    nativeBuildInputs = [ pkgs.coreutils pkgs.jq pkgs.git pkgs.gnused pkgs.patch py ];

    installPhase = ''
      set -euo pipefail
      mkdir -p "$out/site" "$out/bin"
      if [ -d "${uvDrv}/site" ]; then
        cp -R "${uvDrv}/site/." "$out/site/"
      fi
      # The uv2nix site tree comes from the Nix store (read-only perms). Make it writable
      # before merging importer sources or overlays.
      chmod -R u+w "$out/site"
      # Copy app/lib sources into site-packages so native modules can live alongside their packages.
      # This keeps runtime imports deterministic and avoids relying on mixed PYTHONPATH layouts.
      if [ -d "${inputs.src}/${inputs.subdir}/src" ]; then
        cp -R "${inputs.src}/${inputs.subdir}/src/." "$out/site/"
      fi
      # Ensure merged site remains writable before overlays.
      chmod -R u+w "$out/site"
      # Merge optional site overlays deterministically (caller provides stable order).
      for ov in ${overlays.overlayArgs}; do
        if [ -d "$ov/site" ]; then
          chmod -R u+w "$out/site"
          cp -R "$ov/site/." "$out/site/"
        fi
      done

      # Patch provenance: record (key, file, sha256) in deterministic order.
      # - Order by key, then by patch filename.
      tmpPList="$TMPDIR/patches.list"
      : > "$tmpPList"
      ${pkgs.jq}/bin/jq -rc '
        to_entries
        | sort_by(.key)
        | .[]
        | .key as $k
        | (
            (.value // [])
            | map(
                {
                  key: $k,
                  path: .,
                  file: (
                    (.|split("/")[-1])
                    | sub("^.*-py-patch-"; "")
                    | (
                        ($k | gsub("@"; "-") + "-") as $prefix
                        | sub("^" + $prefix; "")
                      )
                  )
                }
              )
            | sort_by(.file)
            | .[]
          )
      ' '${inputs.patchesMapFile}' | while IFS= read -r obj; do
        key="$(${pkgs.jq}/bin/jq -r '.key' <<<"$obj")"
        file="$(${pkgs.jq}/bin/jq -r '.file' <<<"$obj")"
        p="$(${pkgs.jq}/bin/jq -r '.path' <<<"$obj")"
        [ -n "$p" ] || continue
        sha="$(${pkgs.coreutils}/bin/sha256sum "$p" | awk '{print $1}')"
        printf '%s\n' "{\"key\":\"$key\",\"file\":\"$file\",\"sha256\":\"$sha\"}" >> "$tmpPList"
      done
      patchesJson="[$(paste -sd, "$tmpPList")]"

      wrapper="$out/bin/${inputs.pname}"
      cat > "$wrapper" <<'SH'
      #!/usr/bin/env bash
      set -euo pipefail
      HERE="$(cd "$(dirname "$0")" && pwd)"
      # Use the pinned Nix Python to ensure EXT_SUFFIX / ABI matches native modules in $out/site.
      PY="${py}/bin/python"
      export PYTHONPATH="$HERE/../site''${PYTHONPATH:+:$PYTHONPATH}"
      # If a live workspace is provided, append its src tree for debugging/iteration.
      # Keep site-packages first so native modules remain importable.
      if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -d "''${WORKSPACE_ROOT}/${inputs.subdir}/src" ]; then
        export PYTHONPATH="''${PYTHONPATH}:''${WORKSPACE_ROOT}/${inputs.subdir}/src"
      fi
      MAIN="${inputs.src}/${inputs.subdir}/bin/__main__.py"
      if [ -f "$MAIN" ]; then
        exec "$PY" "$MAIN" "$@"
      fi
      if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -f "''${WORKSPACE_ROOT}/${inputs.subdir}/bin/__main__.py" ]; then
        exec "$PY" "''${WORKSPACE_ROOT}/${inputs.subdir}/bin/__main__.py" "$@"
      fi
      echo "python app entrypoint not found at $MAIN" >&2
      echo "PYTHONPATH=$PYTHONPATH" >&2
      exit 2
      SH
      chmod +x "$wrapper"

      cat > "$out/BUILD-INFO.json" <<JSON
      {
        "kind": "${inputs.kind}",
        "lockfile": "${inputs.lockfile}",
        "subdir": "${inputs.subdir}",
        "groups": ${builtins.toJSON inputs.groups},
        "patches": $patchesJson,
        "backend": "uv2nix",
        "uv2nix": { "version": "${meta.version}", "rev": "${meta.rev}" }
      }
      JSON
    '';
  }
 


