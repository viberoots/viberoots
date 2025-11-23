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
  # Normalize dev override paths into the Nix store to avoid sandbox permission issues
  isAbs = p: lib.hasPrefix "/" p;
  isRepoRel = p: lib.hasPrefix "apps/" p || lib.hasPrefix "libs/" p;
  isStorePath = p: lib.hasPrefix "/nix/store/" p;
  toStore = p: builtins.toString (builtins.path { path = builtins.toPath p; name = "uv-dev"; });
  devOverridesCoerced =
    let keys = builtins.attrNames devOverrides;
        step = acc: k:
          let v = devOverrides.${k};
              vv =
                if v == null then null else (
                  if isStorePath v then v
                  else if isAbs v then toStore v
                  else if isRepoRel v then toStore (originRoot + "/" + v)
                  else toStore (builtins.toString src + "/" + v)
                );
          in acc // { "${k}" = vv; };
    in builtins.foldl' step {} keys;
  # Resolve relative origins against BUCK_TEST_SRC or WORKSPACE_ROOT; fallback to flake root
  flakeRoot = builtins.toString ./.;
  buckTestSrc = builtins.getEnv "BUCK_TEST_SRC";
  workspaceEnv = builtins.getEnv "WORKSPACE_ROOT";
  originRoot =
    if (wsRoot != null && wsRoot != "") then wsRoot
    else if buckTestSrc != "" then buckTestSrc
    else if workspaceEnv != "" then workspaceEnv
    else flakeRoot;

  testResolveJSON = builtins.getEnv "NIX_PY_TEST_RESOLVE_JSON";
  patchesMapFile = pkgs.writeText "py-patches.json" (builtins.toJSON patchesMap);
  devOverridesFile = pkgs.writeText "py-dev-overrides.json" (builtins.toJSON devOverridesCoerced);
  testResolveFile =
    if testResolveJSON != "" then pkgs.writeText "py-test-resolve.json" testResolveJSON
    else pkgs.writeText "py-test-resolve.json" "{}";
  # For the uv2nix primary path, embed workspace origins into the store so builds are pure/offline.
  testResolveObj =
    let raw = if testResolveJSON != "" then (builtins.fromJSON testResolveJSON) else {};
        names = builtins.attrNames raw;
        isRepoRel = p: lib.hasPrefix "apps/" p || lib.hasPrefix "libs/" p;
        isAbs = p: lib.hasPrefix "/" p;
        toStore = p: builtins.toString (builtins.path { path = builtins.toPath p; name = "uv-src"; });
        step = acc: name:
          let entry = raw.${name};
              ver = entry.version or null;
              origin = entry.originPath or null;
              storeOrigin =
                if origin == null then null else (
                  if isAbs origin then toStore origin
                  else if isRepoRel origin then toStore (originRoot + "/" + origin)
                  else toStore (builtins.toString src + "/" + origin)
                );
              value = if storeOrigin != null then ({ version = ver; originPath = storeOrigin; })
                      else if origin != null then ({ version = ver; originPath = origin; })
                      else ({ version = ver; });
          in acc // { "${name}" = value; };
    in builtins.foldl' step {} names;

  py = pkgs.python3 or pkgs.python311;
  # Require uv2nix — no stub fallback
  _ = if (uv2nixLib == null)
      then builtins.throw "uv2nix adapter requires uv2nixLib"
      else null;
in
# Primary path: call uv2nixLib to realize the environment (no silent fallbacks).

  let
    uvDrv = uv2nixLib.mkEnv {
      inherit src subdir lockfile wsRoot;
      devOverrides = devOverridesCoerced;
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
      # Compute provenance patches list with sha256 in deterministic order
      tmpPList="$TMPDIR/patches.list"
      : > "$tmpPList"
      ${pkgs.jq}/bin/jq -rc '
        to_entries
        | sort_by(.key)
        | .[]
        | .key as $k
        | ((.value // []) | .[] | {key:$k, path:., display:((.|split("/")[-1]) | sub("^.*-py-patch-"; "") | sub("^" + $k + "-"; ""))})
      ' '${patchesMapFile}' | while IFS= read -r obj; do
        key="$(${pkgs.jq}/bin/jq -r '.key' <<<"$obj")"
        file="$(${pkgs.jq}/bin/jq -r '.path' <<<"$obj")"
        display="$(${pkgs.jq}/bin/jq -r '.display' <<<"$obj")"
        [ -n "$file" ] || continue
        if command -v sha256sum >/dev/null 2>&1; then
          sha="$(sha256sum "$file" | awk '{print $1}')"
        else
          sha="$(shasum -a 256 "$file" | awk '{print $1}')"
        fi
        printf '%s\n' "{\"key\":\"$key\",\"file\":\"$display\",\"sha256\":\"$sha\"}" >> "$tmpPList"
      done
      patchesJson="[$(paste -sd, "$tmpPList")]"
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
 


