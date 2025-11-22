{
  description = "Local uv2nix shim (pinned via path) for Python uv.lock realization";
  outputs = { self }: {
    lib = rec {
      meta = {
        version = "0.0.1-local";
        rev = "local";
      };
      # mkEnv: produce a derivation with a site/ overlay by reading uv.lock and
      # applying patches/devOverrides/testResolve. This mirrors the stub logic
      # but is factored under a flake input to provide identity and a stable API.
      mkEnv = { src, subdir ? ".", lockfile ? "uv.lock", patchesMap ? {}, devOverrides ? {}, testResolve ? {}, wsRoot ? null }:
        let
          sanitize = s: builtins.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;
        in
        (import <nixpkgs> {}).stdenvNoCC.mkDerivation {
          pname = "uv2nix-env";
          version = meta.version;
          inherit src;
          nativeBuildInputs = with (import <nixpkgs> {}); [ coreutils findutils jq gnused patch python3 ];
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
            keysFile="$TMPDIR/keys.txt"
            : > "$keysFile"
            cur_name=""
            cur_ver=""
            while IFS= read -r line; do
              l="$(printf "%s" "$line" | sed -e 's/^[[:space:]]*//')"
              case "$l" in
                "[[package]]"*) if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"; fi; cur_name=""; cur_ver="";;
                name\ =\ \"*\" ) cur_name="$(printf "%s" "$l" | sed -n 's/^name = "\(.*\)".*$/\1/p' | tr '[:upper:]' '[:lower:]')" ;;
                version\ =\ \"*\" ) cur_ver="$(printf "%s" "$l" | sed -n 's/^version = "\(.*\)".*$/\1/p' | tr '[:upper:]' '[:lower:]')" ;;
              esac
            done < "${lockfile}"
            if [ -n "$cur_name" ] && [ -n "$cur_ver" ]; then printf "%s@%s\n" "$cur_name" "$cur_ver" >> "$keysFile"; fi
            sort -u "$keysFile" -o "$keysFile"
            patchesFile="$TMPDIR/patches.json"
            devFile="$TMPDIR/dev.json"
            testFile="$TMPDIR/test.json"
            printf '%s' '${builtins.toJSON patchesMap}' > "$patchesFile"
            printf '%s' '${builtins.toJSON devOverrides}' > "$devFile"
            printf '%s' '${builtins.toJSON testResolve}' > "$testFile"
            while IFS= read -r key; do
              [ -n "$key" ] || continue
              srcPath="$(jq -r --arg k "$key" '.[$k] // empty' "$devFile")"
              if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
                dist="$(printf "%s" "$key" | sed 's/@.*$//')"
                wantVer="$(printf "%s" "$key" | sed 's/^.*@//')"
                origin="$(jq -r --arg d "$dist" '.[$d].originPath // empty' "$testFile")"
                ver="$(jq -r --arg d "$dist" '.[$d].version // empty' "$testFile")"
                if [ -n "$origin" ]; then
                  for c in "$origin" "${src}/$origin" "${src}/${subdir}/$origin" "${toString wsRoot}/${subdir}/$origin"; do
                    if [ -n "$c" ] && [ -e "$c" ]; then origin="$c"; break; fi
                  done
                fi
                if [ -n "$origin" ] && [ -e "$origin" ]; then
                  if [ -z "$ver" ] || [ "$ver" = "$wantVer" ]; then srcPath="$origin"; fi
                fi
              fi
              [ -n "$srcPath" ] && [ -e "$srcPath" ] || continue
              work="$TMPDIR/work-$(echo "$key" | tr '@' '_' | tr '/' '_')"
              mkdir -p "$work"
              cp -a "$srcPath"/. "$work"/
              chmod -R u+w "$work" || true
              jq -r --arg k "$key" '.[$k][]? // empty' "$patchesFile" | while IFS= read -r patchFile; do
                [ -n "$patchFile" ] || continue
                if [ -f "$patchFile" ]; then (cd "$work" && patch -p1 -t -N < "$patchFile"); fi
              done
              pkgDirs="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
              if [ "$pkgDirs" = "1" ]; then d="$(find "$work" -mindepth 1 -maxdepth 1 -type d -print | head -n1)"; cp -a "$d" "$site/"; else cp -a "$work"/. "$site/"; fi
            done < "$keysFile"
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out/site"
            if [ -d "$TMPDIR/site" ]; then cp -R "$TMPDIR/site/." "$out/site/"; fi
          '';
        };
    };
  };
}


