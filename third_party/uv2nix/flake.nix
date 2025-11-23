{
  description = "Local uv2nix shim (pinned via path) for Python uv.lock realization";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };
  outputs = { self, nixpkgs }: {
    lib = rec {
      meta = {
        version = "0.0.2-local";
        rev = "local";
      };
      # mkEnvFor: closure that returns a builder bound to provided pkgs
      mkEnvFor = pkgs: { src, subdir ? ".", lockfile ? "uv.lock", patchesMap ? {}, devOverrides ? {}, testResolve ? {}, wsRoot ? null }:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "uv2nix-env";
          version = meta.version;
          src = ./.; # do not let stdenv unpack the app sources; we operate on copies
          dontUnpack = true;
          dontPatch = true;
          dontConfigure = true;
          phases = [ "buildPhase" "installPhase" ];
          nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused (pkgs.python3 or pkgs.python311) ];
          buildPhase = ''
            set -euo pipefail
            set -x
            SRC="${src}"
            WORK="$TMPDIR/work-root"
            mkdir -p "$WORK"
            cp -a "${src}/." "$WORK/" || true
            chmod -R u+w "$WORK" || true
            # srcAbs points directly at the importer subdir snapshot; operate from here.
            cd "$WORK"
            if [ ! -f "${lockfile}" ]; then
              if [ -n "${toString wsRoot}" ] && [ -f "${toString wsRoot}/${subdir}/${lockfile}" ]; then
                cp "${toString wsRoot}/${subdir}/${lockfile}" "./${lockfile}"
              elif [ -f "$WORK/${subdir}/${lockfile}" ]; then
                cp "$WORK/${subdir}/${lockfile}" "./${lockfile}"
              elif [ -f "$WORK/uv.lock" ]; then
                cp "$WORK/uv.lock" "./${lockfile}"
              else
                echo "[uv2nix-lib] missing lockfile: ${lockfile}" >&2
                exit 1
              fi
            fi
            site="$TMPDIR/site"
            mkdir -p "$site"
            patchesFile="$TMPDIR/patches.json"
            devFile="$TMPDIR/dev.json"
            testFile="$TMPDIR/test.json"
            printf '%s' '${builtins.toJSON patchesMap}' > "$patchesFile"
            printf '%s' '${builtins.toJSON devOverrides}' > "$devFile"
            printf '%s' '${builtins.toJSON testResolve}' > "$testFile"
            keysFile="$TMPDIR/keys.txt"
            : > "$keysFile"
            ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).python3 or (nixpkgs.legacyPackages.${builtins.currentSystem}).python311 }/bin/python - "${lockfile}" > "$keysFile" <<'PY'
import sys, re
lock_path = sys.argv[1]
try:
    with open(lock_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
except Exception:
    lines = []
keys = []
cur_name = None
cur_ver = None
for raw in lines:
    s = raw.strip()
    if s.startswith("[[package]]"):
        if cur_name and cur_ver:
            keys.append(f"{cur_name.lower()}@{cur_ver.lower()}")
        cur_name = None
        cur_ver = None
    elif s.startswith("name = "):
        m = re.match(r'^name = "([^"]+)"', s)
        if m:
            cur_name = m.group(1)
    elif s.startswith("version = "):
        m = re.match(r'^version = "([^"]+)"', s)
        if m:
            cur_ver = m.group(1)
if cur_name and cur_ver:
    keys.append(f"{cur_name.lower()}@{cur_ver.lower()}")
for k in sorted(set(keys)):
    print(k)
PY
            keysFromTest="$TMPDIR/keys_test.txt"
            : > "$keysFromTest"
            jq -r 'keys[] as $k | "\($k)@\(.[$k].version // \"0.0.0\")"' "$testFile" > "$keysFromTest" 2>/dev/null || true
            cat "$keysFile" "$keysFromTest" | sort -u > "$TMPDIR/keys_merged.txt" || true
            mv "$TMPDIR/keys_merged.txt" "$keysFile"
            echo "[uv2nix-lib] keys (updated):" >&2
            (cat "$keysFile" || true) >&2
            for key in $(cat "$keysFile"); do
              [ -n "$key" ] || continue
              srcPath="$(jq -r --arg k "$key" '.[$k] // empty' "$devFile")"
              echo "[uv2nix-lib] processing key=$key srcPath=$srcPath" >&2
              if [ -z "$srcPath" ] || [ ! -e "$srcPath" ]; then
                dist="$(printf "%s" "$key" | sed 's/@.*$//')"
                wantVer="$(printf "%s" "$key" | sed 's/^.*@//')"
                origin="$(jq -r --arg d "$dist" '.[$d].originPath // empty' "$testFile")"
                ver="$(jq -r --arg d "$dist" '.[$d].version // empty' "$testFile")"
                if [ -n "$origin" ]; then
                  originRel="$origin"
                  for c in \
                    "$origin" \
                    "$originRel" \
                    "$WORK/$originRel" \
                    "$WORK/$origin" \
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
              if [ -z "$srcPath" ] && [ -d "vendor/''${dist}-''${wantVer}" ]; then
                srcPath="vendor/''${dist}-''${wantVer}"
              fi
              [ -n "$srcPath" ] && [ -e "$srcPath" ] || continue
              workPkg="$TMPDIR/work-$(echo "$key" | tr '@' '_' | tr '/' '_')"
              mkdir -p "$workPkg"
              cp -a "$srcPath"/. "$workPkg"/
              chmod -R u+w "$workPkg" || true
              echo "[uv2nix-lib] materialize key=$key from=$srcPath" >&2
              for patchFile in $(jq -r --arg k "$key" '.[$k][]? // empty' "$patchesFile"); do
                [ -n "$patchFile" ] || continue
                if [ -f "$patchFile" ]; then
                  tmpPatch="$TMPDIR/$(basename "$patchFile")"
                  cp -f "$patchFile" "$tmpPatch" || true
                  echo "[uv2nix-lib] head $tmpPatch:" >&2
                  head -n 6 "$tmpPatch" >&2 || true
                  ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).gnused or (nixpkgs.legacyPackages.${builtins.currentSystem}).sed }/bin/sed -i $'s/\r$//' "$tmpPatch" || true
                  ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).gnused or (nixpkgs.legacyPackages.${builtins.currentSystem}).sed }/bin/sed -E -i 's/^@@$/@@ -1,999 +1,999 @@/' "$tmpPatch" || true
                  tgt="$(grep -E '^--- a/|^\+\+\+ b/' "$tmpPatch" | head -n1 | sed -E 's|^--- a/||; s|^\+\+\+ b/||')"
                  echo "[uv2nix-lib] patch=$tmpPatch target=$tgt" >&2
                  cand="$workPkg/$tgt"
                  if [ ! -f "$cand" ] && [ -n "$tgt" ]; then
                    cand="$(cd "$workPkg" && find . -type f -path "./$tgt" -print -quit || true)"
                    if [ -n "$cand" ] && [ -f "$workPkg/''${cand#./}" ]; then
                      cand="$workPkg/''${cand#./}"
                    else
                      base="$(basename "$tgt")"
                      cand="$(cd "$workPkg" && find . -type f -name "$base" -print | head -n1 || true)"
                      if [ -n "$cand" ] && [ -f "$workPkg/''${cand#./}" ]; then
                        cand="$workPkg/''${cand#./}"
                      else
                        cand=""
                      fi
                    fi
                  fi
                  if [ -n "$cand" ] && [ -f "$cand" ]; then
                    oldB="$TMPDIR/old.$$"; newB="$TMPDIR/new.$$"
                    sed -n '1,/^@@/d; /^\-/p' "$tmpPatch" | sed 's/^-//' > "$oldB"
                    sed -n '1,/^@@/d; /^\+/p' "$tmpPatch" | sed 's/^+//' > "$newB"
                    ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).python3 or (nixpkgs.legacyPackages.${builtins.currentSystem}).python311 }/bin/python - "$cand" "$oldB" "$newB" <<'PY'
import sys
fp, oldf, newf = sys.argv[1], sys.argv[2], sys.argv[3]
with open(oldf, "r", encoding="utf-8") as f: old = f.read()
with open(newf, "r", encoding="utf-8") as f: new = f.read()
with open(fp, "r", encoding="utf-8") as f: data = f.read()
# Deterministic textual replacement; raise on missing old block to surface bad hunks
if old not in data:
    raise SystemExit("[uv2nix-lib] expected old block not found in {}".format(fp))
data = data.replace(old, new)
with open(fp, "w", encoding="utf-8") as f: f.write(data)
PY
                  else
                    oldB="$TMPDIR/old.$$"; newB="$TMPDIR/new.$$"
                    sed -n '1,/^@@/d; /^\-/p' "$tmpPatch" | sed 's/^-//' > "$oldB"
                    sed -n '1,/^@@/d; /^\+/p' "$tmpPatch" | sed 's/^+//' > "$newB"
                    ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).python3 or (nixpkgs.legacyPackages.${builtins.currentSystem}).python311 }/bin/python - "$workPkg" "$oldB" "$newB" <<'PY'
import sys
from pathlib import Path
root, oldf, newf = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
old = oldf.read_text(encoding="utf-8")
new = newf.read_text(encoding="utf-8")
applied = False
for p in root.rglob("*"):
    if p.is_file():
        try:
            s = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if old in s:
            p.write_text(s.replace(old, new), encoding="utf-8")
            applied = True
            break
if not applied:
    raise SystemExit("[uv2nix-lib] could not find a target file for textual patch fallback")
PY
                  fi
                fi
              done
                pkgDirs="$(find "$workPkg" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' ')"
                if [ "$pkgDirs" = "1" ]; then d="$(find "$workPkg" -mindepth 1 -maxdepth 1 -type d -print | head -n1)"; cp -a "$d" "$site/"; else cp -a "$workPkg"/. "$site"/; fi
            done
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out/site"
            cp -R "$TMPDIR/site/." "$out/site/" || true
          '';
        };
    };
  };
}


