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
  ensureAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw ("uv2nix adapter: expected " + ctxStr + " to be an attrset");
  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("uv2nix adapter: expected " + ctxStr + " to be a list of strings");

  patchesMap = ensureAttrs "patchesMap" (args.patchesMap or {});
  devOverrides = ensureAttrs "devOverrides" (args.devOverrides or {});
  kind = args.kind or "app";
  wsRoot = args.wsRoot or null;
  groups = ensureStringList "groups" (args.groups or []);
  siteOverlays0 = args.siteOverlays or [];
  siteOverlays =
    if builtins.isList siteOverlays0 then siteOverlays0
    else builtins.throw "uv2nix adapter: siteOverlays must be a list";
  # Note: overlays may be derivations; do NOT use builtins.toFile here (it rejects derivation refs).
  overlayArgs =
    let
      asArg = x: lib.escapeShellArg (builtins.toString x);
    in lib.concatStringsSep " " (builtins.map asArg siteOverlays);
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
  _lockfileRequired =
    if lockfile == null || lockfile == ""
    then builtins.throw "uv2nix adapter requires lockfile"
    else null;

  srcForUv2nixEnv =
    let
      srcStr = builtins.toString src;
      subdirStr = if subdir == "." || subdir == "" then "" else subdir;
      lockAbs = builtins.toPath (
        srcStr
        + (if subdirStr == "" then "" else "/" + subdirStr)
        + "/" + lockfile
      );
      lockStore = builtins.path { path = lockAbs; name = "uv.lock"; };
      dest = "$out/" + (if subdirStr == "" then "" else subdirStr + "/") + lockfile;
    in
      pkgs.runCommand "uv2nix-env-src" {} ''
        set -euo pipefail
        mkdir -p "$(dirname "${dest}")"
        cp ${lockStore} "${dest}"
      '';
in
# Primary path: call uv2nixLib to realize the environment (no silent fallbacks).

  let
    uvDrv = uv2nixLib.mkEnv {
      src = srcForUv2nixEnv;
      inherit subdir lockfile;
      devOverrides = devOverridesCoerced;
      # PR-2: delegate patching to uv2nix; pass patchesMap and testResolve as structured inputs.
      patchesMap = patchesMap;
      testResolve = testResolveObj;
      groups = groups;
      kind = kind;
    };
    _uv2nixLibOk =
      if uv2nixLib == null then builtins.throw "uv2nix adapter requires uv2nixLib"
      else if !(builtins.isAttrs uv2nixLib) then builtins.throw "uv2nix adapter: uv2nixLib must be an attrset"
      else if !(uv2nixLib ? mkEnv) then builtins.throw "uv2nix adapter: uv2nixLib.mkEnv missing"
      else null;
    metaRaw = if (uv2nixLib ? meta) then uv2nixLib.meta else null;
    meta =
      if (metaRaw != null && builtins.isAttrs metaRaw)
      then metaRaw
      else { version = "unknown"; rev = "unknown"; };
  in
  pkgs.stdenvNoCC.mkDerivation {
    inherit pname version src;
    passthru = {
      uv2nixEnv = uvDrv;
      srcForUv2nixEnv = srcForUv2nixEnv;
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
      if [ -d "${src}/${subdir}/src" ]; then
        cp -R "${src}/${subdir}/src/." "$out/site/"
      fi
      # Ensure merged site remains writable before overlays.
      chmod -R u+w "$out/site"
      # Merge optional site overlays deterministically (caller provides stable order).
      for ov in ${overlayArgs}; do
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
      ' '${patchesMapFile}' | while IFS= read -r obj; do
        key="$(${pkgs.jq}/bin/jq -r '.key' <<<"$obj")"
        file="$(${pkgs.jq}/bin/jq -r '.file' <<<"$obj")"
        p="$(${pkgs.jq}/bin/jq -r '.path' <<<"$obj")"
        [ -n "$p" ] || continue
        sha="$(${pkgs.coreutils}/bin/sha256sum "$p" | awk '{print $1}')"
        printf '%s\n' "{\"key\":\"$key\",\"file\":\"$file\",\"sha256\":\"$sha\"}" >> "$tmpPList"
      done
      patchesJson="[$(paste -sd, "$tmpPList")]"

      wrapper="$out/bin/${pname}"
      cat > "$wrapper" <<'SH'
      #!/usr/bin/env bash
      set -euo pipefail
      HERE="$(cd "$(dirname "$0")" && pwd)"
      # Use the pinned Nix Python to ensure EXT_SUFFIX / ABI matches native modules in $out/site.
      PY="${py}/bin/python"
      export PYTHONPATH="$HERE/../site''${PYTHONPATH:+:$PYTHONPATH}"
      # If a live workspace is provided, append its src tree for debugging/iteration.
      # Keep site-packages first so native modules remain importable.
      if [ -n "''${WORKSPACE_ROOT:-}" ] && [ -d "''${WORKSPACE_ROOT}/${subdir}/src" ]; then
        export PYTHONPATH="''${PYTHONPATH}:''${WORKSPACE_ROOT}/${subdir}/src"
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
        "patches": $patchesJson,
        "backend": "uv2nix",
        "uv2nix": { "version": "${meta.version}", "rev": "${meta.rev}" }
      }
      JSON
    '';
  }
 


