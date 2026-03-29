{
  description = "Local uv2nix shim (pinned via path) for Python uv.lock realization";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };
  outputs = { self, nixpkgs }: {
    lib = rec {
      meta = {
        version = "0.0.3-local";
        rev = "local";
      };
      # mkEnvFor: closure that returns a builder bound to provided pkgs
      mkEnvFor = pkgs: { src, subdir ? ".", lockfile ? "uv.lock", patchesMap ? {}, devOverrides ? {}, testResolve ? {}, wsRoot ? null, groups ? [], kind ? "app" }:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "uv2nix-env";
          version = meta.version;
          src = ./.; # do not let stdenv unpack the app sources; we operate on copies
          dontUnpack = true;
          dontPatch = true;
          dontConfigure = true;
          phases = [ "buildPhase" "installPhase" ];
          nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.jq pkgs.gnused pkgs.patch (pkgs.python3 or pkgs.python311) ];
          buildPhase = ''
            set -euo pipefail
            SRC="${src}"
            WORK="$TMPDIR/work-root"
            SITE="$TMPDIR/site"
            INFO="$TMPDIR/build-info.json"
            mkdir -p "$WORK" "$SITE"
            cp -a "${src}/." "$WORK/" || true
            chmod -R u+w "$WORK" || true
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
            PATCHES_FILE="$TMPDIR/patches.json"
            DEV_FILE="$TMPDIR/dev.json"
            TEST_FILE="$TMPDIR/test.json"
            export PATCHES_FILE DEV_FILE TEST_FILE
            printf '%s' '${builtins.toJSON patchesMap}' > "$PATCHES_FILE"
            printf '%s' '${builtins.toJSON devOverrides}' > "$DEV_FILE"
            printf '%s' '${builtins.toJSON testResolve}' > "$TEST_FILE"
            # Export builder context for the Python script
            export WORK="$WORK"
            export subdir="${subdir}"
            export lockfile="${lockfile}"
            export wsRoot="${toString wsRoot}"
            export uv2nix_version="${meta.version}"
            export uv2nix_rev="${meta.rev}"
            export uv2nix_kind="${kind}"
            export uv2nix_groups='${builtins.toJSON groups}'
            export INFO="$INFO"
            ${ (nixpkgs.legacyPackages.${builtins.currentSystem}).python3 or (nixpkgs.legacyPackages.${builtins.currentSystem}).python311 }/bin/python - <<'PY'
import io, json, os, re, shutil, subprocess, sys, hashlib, tempfile
from pathlib import Path

lockfile = Path(os.environ.get("lockfile") or "uv.lock")
work_root = Path(os.environ.get("WORK") or ".")
tmpdir = Path(os.environ.get("TMPDIR","/tmp"))
site_dir = tmpdir / "site"
info_file = Path(os.environ.get("INFO") or (tmpdir / "build-info.json"))
patches_path = tmpdir / "patches.json"
dev_file = tmpdir / "dev.json"
test_file = tmpdir / "test.json"
subdir = os.environ.get("subdir","." )
ws_root = os.environ.get("wsRoot") or ""
uv2nix_version = os.environ.get("uv2nix_version") or "unknown"
uv2nix_rev = os.environ.get("uv2nix_rev") or "unknown"
uv2nix_kind = os.environ.get("uv2nix_kind") or "app"
try:
    uv2nix_groups = json.loads(os.environ.get("uv2nix_groups") or "[]")
except Exception:
    uv2nix_groups = []

def read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}

patches_map = read_json(patches_path)
dev_overrides = read_json(dev_file)
test_resolve = read_json(test_file)

def parse_keys_from_lock(p: Path):
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
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
    # merge test_resolve keys
    for dist, ent in test_resolve.items():
        ver = (ent or {}).get("version") or "0.0.0"
        keys.append(f"{dist.lower()}@{str(ver).lower()}")
    return sorted(set(keys))

def materialize_src_for_key(key: str) -> Path | None:
    # dev override has precedence (map is key -> path)
    src = dev_overrides.get(key) or ""
    if src and Path(src).exists():
        return Path(src)
    dist, ver = key.split("@", 1)
    ent = test_resolve.get(dist, {}) or {}
    origin = ent.get("originPath") or ""
    if origin:
        candidates = [
            origin,
            str(work_root / origin),
            str(work_root / subdir / origin),
        ]
        if ws_root:
            candidates += [
                str(Path(ws_root) / origin),
                str(Path(ws_root) / subdir / origin),
            ]
        for c in candidates:
            if c and Path(c).exists():
                origin = c
                break
    if origin and Path(origin).exists():
        if (not ent.get("version")) or str(ent.get("version")).lower() == ver.lower():
            return Path(origin)
    vend = work_root / f"vendor/{dist}-{ver}"
    if vend.exists():
        return vend
    return None

def normalize_and_validate_patch(patch_file: Path) -> Path:
    content = patch_file.read_text(encoding="utf-8")
    # Normalize line endings and ensure trailing newline
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    if not content.endswith("\n"):
        content = content + "\n"
    # Guard against binary patch formats (reject by default)
    # Detect common git binary patch markers and fail fast with an actionable error.
    if re.search(r'(?m)^(GIT binary patch|literal \d+|delta \d+)\b', content):
        sys.stderr.write("[uv2nix-lib][strict] binary patches are not supported (reject by default): " + patch_file.name + "\n")
        raise SystemExit(2)
    # Expand bare '@@' hunks with computed line counts
    lines = content.splitlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.fullmatch(r'@@\s*', line):
            j = i + 1
            old_cnt = 0
            new_cnt = 0
            while j < len(lines):
                L = lines[j]
                if L.startswith('@@') or L.startswith('--- ') or L.startswith('+++ '):
                    break
                if L.startswith(' '):
                    old_cnt += 1
                    new_cnt += 1
                elif L.startswith('-') and not L.startswith('--- '):
                    old_cnt += 1
                elif L.startswith('+') and not L.startswith('+++ '):
                    new_cnt += 1
                j += 1
            out.append(f'@@ -1,{old_cnt} +1,{new_cnt} @@')
            i += 1
            continue
        out.append(line)
        i += 1
    content = "\n".join(out) + "\n"
    if not re.search(r'^---\s+a/', content, flags=re.M):
        sys.stderr.write("[uv2nix-lib][strict] malformed patch: missing '--- a/<path>' header in " + patch_file.name + "\n")
        raise SystemExit(2)
    if not re.search(r'^\+\+\+\s+b/', content, flags=re.M):
        sys.stderr.write("[uv2nix-lib][strict] malformed patch: missing '+++ b/<path>' header in " + patch_file.name + "\n")
        raise SystemExit(2)
    headers = re.findall(r'^(---\s+a/|^\+\+\+\s+b/)(.+)$', content, flags=re.M)
    for _, path in headers:
        if "/.." in path:
            sys.stderr.write("[uv2nix-lib][strict] unsafe patch path traversal detected in " + patch_file.name + "\n")
            raise SystemExit(3)
    patch_hash = hashlib.sha256((str(patch_file) + "\0" + content).encode("utf-8")).hexdigest()[:16]
    patch_tmpdir = Path(tempfile.mkdtemp(prefix="uv2nix-patch-", dir=str(tmpdir)))
    tmp = patch_tmpdir / f"{patch_hash}-{patch_file.name}"
    tmp.write_text(content, encoding="utf-8")
    return tmp

site_dir.mkdir(parents=True, exist_ok=True)
keys = parse_keys_from_lock(lockfile)
# Provenance patches list
prov_patches = []
for key in keys:
    if not key:
        continue
    src_path = materialize_src_for_key(key)
    sys.stderr.write("[uv2nix-lib] processing key=%s srcPath=%s\n" % (key, (src_path or "")))
    if not src_path or not src_path.exists():
        continue
    is_dev_override = bool(dev_overrides.get(key))
    sys.stderr.write("[uv2nix-lib] is_dev_override=%s\n" % ("yes" if is_dev_override else "no"))
    work_pkg_root = Path(
        tempfile.mkdtemp(
            prefix=("work-" + key.replace("@","_").replace("/","_") + "-"),
            dir=str(tmpdir),
        )
    )
    work_pkg = work_pkg_root / "src"
    shutil.copytree(src_path, work_pkg)
    # ensure work tree is writable
    for dirpath, dirnames, filenames in os.walk(work_pkg):
        for dn in dirnames:
            try:
                os.chmod(Path(dirpath) / dn, 0o755)
            except Exception:
                pass
        for fn in filenames:
            try:
                os.chmod(Path(dirpath) / fn, 0o644)
            except Exception:
                pass
    # apply patches if any (preserve declared order for determinism)
    # When a dev override is provided for this key, skip applying patches to avoid reversed hunks.
    if not is_dev_override:
        # Sort patches by basename to enforce lexicographic within key
        patch_list = sorted((patches_map.get(key) or []), key=lambda p: os.path.basename(p))
        for patch in patch_list:
            pf = Path(patch)
            if not pf.exists():
                continue
            # provenance entry
            try:
                h = hashlib.sha256()
                with open(pf, "rb") as f:
                    while True:
                        chunk = f.read(8192)
                        if not chunk:
                            break
                        h.update(chunk)
                prov_patches.append({
                    "key": key,
                    "file": os.path.basename(pf),
                    "sha256": h.hexdigest(),
                })
            except Exception:
                # best-effort; still attempt to apply the patch
                prov_patches.append({
                    "key": key,
                    "file": os.path.basename(pf),
                    "sha256": "",
                })
            tmp_patch = normalize_and_validate_patch(pf)
            # apply with patch(1)
            res = subprocess.run(["patch","-p1","--fuzz=0","-i", str(tmp_patch)], cwd=str(work_pkg), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                sys.stderr.write(res.stdout + res.stderr)
                raise SystemExit(4)
    # install to site
    entries = [p for p in work_pkg.iterdir() if p.is_dir()]
    if len(entries) == 1:
        dst = site_dir / entries[0].name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(entries[0], dst)
    else:
        for item in work_pkg.iterdir():
            dst = site_dir / item.name
            if item.is_dir():
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)
# Emit BUILD-INFO.json
try:
    # Sort provenance by key then file to be deterministic
    prov_sorted = sorted(prov_patches, key=lambda e: (e.get("key",""), e.get("file","")))
    info = {
        "kind": uv2nix_kind,
        "lockfile": str(lockfile),
        "subdir": subdir,
        "groups": uv2nix_groups,
        "patches": prov_sorted,
        "backend": "uv2nix",
        "uv2nix": { "version": uv2nix_version, "rev": uv2nix_rev },
    }
    info_file.write_text(json.dumps(info, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
except Exception as e:
    sys.stderr.write("[uv2nix-lib] failed to write BUILD-INFO.json: %s\n" % (e,))
PY
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out/site"
            cp -R "$TMPDIR/site/." "$out/site/" || true
            if [ -f "$TMPDIR/build-info.json" ]; then
              cp "$TMPDIR/build-info.json" "$out/BUILD-INFO.json"
            fi
          '';
        };
    };
  };
}
