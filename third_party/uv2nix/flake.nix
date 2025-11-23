{
  description = "Local uv2nix shim (pinned via path) for Python uv.lock realization";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };
  outputs = { self, nixpkgs }: {
    lib = rec {
      meta = {
        version = "0.0.1-local";
        rev = "local";
      };
      # mkEnvFor: closure that returns a builder bound to provided pkgs
      mkEnvFor = pkgs: { src, subdir ? ".", lockfile ? "uv.lock", patchesMap ? {}, devOverrides ? {}, testResolve ? {}, wsRoot ? null }:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "uv2nix-env";
          version = meta.version;
          inherit src;
          nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused pkgs.patch (pkgs.python3 or pkgs.python311) ];
          buildPhase = ''
            set -euo pipefail
            if [ -d "${subdir}" ]; then cd "${subdir}"; fi
            if [ ! -f "${lockfile}" ]; then
              if [ -n "${toString wsRoot}" ] && [ -f "${toString wsRoot}/${subdir}/${lockfile}" ]; then
                cp "${toString wsRoot}/${subdir}/${lockfile}" "./${lockfile}"
              elif [ -f "${src}/${subdir}/${lockfile}" ]; then
                cp "${src}/${subdir}/${lockfile}" "./${lockfile}"
              elif [ -f "${src}/uv.lock" ]; then
                cp "${src}/uv.lock" "./${lockfile}"
              else
                echo "[uv2nix-lib] missing lockfile: ${lockfile}" >&2
                exit 1
              fi
            fi
            mkdir -p "$TMPDIR/site"
            site="$TMPDIR/site"
            patchesFile="$TMPDIR/patches.json"
            devFile="$TMPDIR/dev.json"
            testFile="$TMPDIR/test.json"
            printf '%s' '${builtins.toJSON patchesMap}' > "$patchesFile"
            printf '%s' '${builtins.toJSON devOverrides}' > "$devFile"
            printf '%s' '${builtins.toJSON testResolve}' > "$testFile"
            keysFile="$TMPDIR/keys.txt"
            : > "$keysFile"
            cur_name=""
            cur_ver=""
            while IFS= read -r line; do
              l="$(printf "%s" "$line" | sed -e 's/^[[:space:]]*//')"
              case "$l" in
                "[[package]]"*) if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"; fi; cur_name=""; cur_ver="";;
                name\ =\ \"*\" ) cur_name="$(printf "%s" "$l" | sed -n 's/^name = \"\(.*\)\".*$/\1/p' | tr '[:upper:]' '[:lower:]')" ;;
                version\ =\ \"*\" ) cur_ver="$(printf "%s" "$l" | sed -n 's/^version = \"\(.*\)\".*$/\1/p' | tr '[:upper:]' '[:lower:]')" ;;
              esac
            done < "${lockfile}"
            if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"; fi
            sort -u "$keysFile" -o "$keysFile"
            # Also derive keys from testResolve and merge (union) with uv.lock
            keysFromTest="$TMPDIR/keys_test.txt"
            : > "$keysFromTest"
            jq -r 'keys[] as $k | "\($k)@\(.[$k].version // \"0.0.0\")"' "$testFile" > "$keysFromTest" 2>/dev/null || true
            cat "$keysFile" "$keysFromTest" | sort -u > "$TMPDIR/keys_merged.txt" || true
            mv "$TMPDIR/keys_merged.txt" "$keysFile"
            echo "[uv2nix-lib] keys:" >&2
            (cat "$keysFile" || true) >&2
            while IFS= read -r key; do
              [ -n "$key" ] || continue
              srcPath="$(jq -r --arg k "$key" '.[$k] // empty' "$devFile")"
              if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
                dist="$(printf "%s" "$key" | sed 's/@.*$//')"
                wantVer="$(printf "%s" "$key" | sed 's/^.*@//')"
                origin="$(jq -r --arg d "$dist" '.[$d].originPath // empty' "$testFile")"
                ver="$(jq -r --arg d "$dist" '.[$d].version // empty' "$testFile")"
                if [ -n "$origin" ]; then
                  # Normalize origin relative to current subdir (best-effort)
                  originRel="$origin"
                  for c in \
                    "$origin" \
                    "$originRel" \
                    "${src}/$originRel" \
                    "${src}/$origin" \
                    "${toString wsRoot}/$originRel" \
                    "${toString wsRoot}/$origin" \
                    "${toString wsRoot}/${subdir}/$originRel" ; do
                    if [ -n "$c" ] && [ -e "$c" ]; then origin="$c"; break; fi
                  done
                fi
                if [ -n "$origin" ] && [ -e "$origin" ]; then
                  if [ -z "$ver" ] || [ "$ver" = "$wantVer" ]; then srcPath="$origin"; fi
                fi
              fi
              # Embed vendor layout from the store snapshot when available
              if [ -z "$srcPath" ] && [ -d "vendor/''${dist}-''${wantVer}" ]; then
                srcPath="vendor/''${dist}-''${wantVer}"
              fi
              [ -n "$srcPath" ] && [ -e "$srcPath" ] || continue
              work="$TMPDIR/work-$(echo "$key" | tr '@' '_' | tr '/' '_')"
              mkdir -p "$work"
              cp -a "$srcPath"/. "$work"/
              chmod -R u+w "$work" || true
              echo "[uv2nix-lib] materialize key=$key from=$srcPath" >&2
              jq -r --arg k "$key" '.[$k][]? // empty' "$patchesFile" | while IFS= read -r patchFile; do
                [ -n "$patchFile" ] || continue
                if [ -f "$patchFile" ]; then
                  tmpPatch="$TMPDIR/$(basename "$patchFile")"
                  cp -f "$patchFile" "$tmpPatch" || true
                  echo "[uv2nix-lib] head $tmpPatch:" >&2
                  head -n 6 "$tmpPatch" >&2 || true
                  # Primary: deterministic text replacement based on unified hunks
                  ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).gnused or (nixpkgs.legacyPackages.${builtins.currentSystem}).sed }/bin/sed -i $'s/\r$//' "$tmpPatch" || true
                  tgt="$(grep -E '^--- a/' "$tmpPatch" | head -n1 | sed -E 's|^--- a/||')"
                  echo "[uv2nix-lib] patch=$tmpPatch target=$tgt" >&2
                  if [ -n "$tgt" ] && [ -f "$work/$tgt" ]; then
                    oldB="$TMPDIR/old.$$"; newB="$TMPDIR/new.$$"
                    sed -n '1,/^@@/d; /^\-/p' "$tmpPatch" | sed 's/^-//' > "$oldB"
                    sed -n '1,/^@@/d; /^\+/p' "$tmpPatch" | sed 's/^+//' > "$newB"
                    ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).python3 or (nixpkgs.legacyPackages.${builtins.currentSystem}).python311 }/bin/python - "$work/$tgt" "$oldB" "$newB" <<'PY'
import sys
fp, oldf, newf = sys.argv[1], sys.argv[2], sys.argv[3]
with open(oldf, "r", encoding="utf-8") as f: old = f.read()
with open(newf, "r", encoding="utf-8") as f: new = f.read()
with open(fp, "r", encoding="utf-8") as f: data = f.read()
data = data.replace(old, new)
with open(fp, "w", encoding="utf-8") as f: f.write(data)
PY
                  else
                    # Best-effort: try POSIX patch for formats without explicit headers
                    sed -E -i 's/^@@$/@@ -1,999 +1,999 @@/' "$tmpPatch" || true
                    (cd "$work" && patch -p1 -t -N -i "$tmpPatch") || true
                  fi
                fi
              done
              pkgDirs="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
              if [ "$pkgDirs" = "1" ]; then d="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | head -n1)"; cp -a "$d" "$site/"; else cp -a "$work"/. "$site"/; fi
            done < "$keysFile"
            echo "[uv2nix-lib] site listing:" >&2
            (find "$site" -maxdepth 2 -type f -print || true) >&2
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out/site"
            echo "[uv2nix-lib] TMPDIR site listing before copy:" >&2
            (find "$TMPDIR/site" -maxdepth 2 -type f -print || true) >&2
            if [ -d "$TMPDIR/site" ]; then cp -R "$TMPDIR/site/." "$out/site/"; fi
            echo "[uv2nix-lib] OUT site listing after copy:" >&2
            (find "$out/site" -maxdepth 2 -type f -print || true) >&2
          '';
        };
    };
  };
}


