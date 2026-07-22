{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null, allowLiveHashMap ? true }:
let
  common = import ./common.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal allowLiveHashMap; };
  lib = common.lib;
  node = pkgs.nodejs_22;
  pnpm = import ../pnpm-11.nix { inherit pkgs; };
  nix = pkgs.nix;
  certs = pkgs.cacert;
  dirnameOf = common.dirnameOf;
  importerOnlySrc = common.importerOnlySrc;
  hashMap = common.hashMap;
  placeholderDigest = common.placeholderDigest;
  supportedPlatforms = import ./supported-platforms.nix { };
  pnpmSupportedArchitectureMarkers = supportedPlatforms.universalMarkers;
  pnpmWorkspaceMarkerScript = ''
    write_pnpm_workspace_marker() {
      local supported_architectures="$1"
      local existing="$TMPDIR/pnpm-workspace.source.yaml"
      local workspace_config=""
      local search_dir="$PWD"
      while [ -n "$search_dir" ] && [ "$search_dir" != "/" ]; do
        if [ -f "$search_dir/pnpm-workspace.yaml" ]; then
          workspace_config="$search_dir/pnpm-workspace.yaml"
          break
        fi
        search_dir="$(dirname "$search_dir")"
      done
      if [ -n "$workspace_config" ]; then
        cp "$workspace_config" "$existing"
      else
        : > "$existing"
      fi
      node - "$existing" <<'NODE' > pnpm-workspace.yaml
const fs = require("fs");
const input = process.argv[2];
const lines = fs.existsSync(input) ? fs.readFileSync(input, "utf8").split(/\r?\n/) : [];
const out = ["packages:", "  - ./"];
const skipKeys = new Set(["packages", "supportedArchitectures"]);
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (line.trim() === "" || line.trimStart().startsWith("#")) {
    i += 1;
    continue;
  }
  const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
  if (!match) {
    i += 1;
    continue;
  }
  const key = match[1];
  const start = i;
  i += 1;
  while (i < lines.length && !/^[A-Za-z0-9_.-]+:(?:\s|$)/.test(lines[i])) {
    i += 1;
  }
  if (!skipKeys.has(key)) {
    out.push(...lines.slice(start, i));
  }
}
process.stdout.write(out.join("\n") + "\n");
NODE
      printf '%s\n' "$supported_architectures" >> pnpm-workspace.yaml
    }
  '';
  populatePnpmStoreScript = label: ''
    populate_pnpm_store() {
      echo "[nix] ${label}: populating fixed pnpm store from committed lock and hash metadata" >&2
      mkdir -p "$out/store"
      local modules_dir="$out/.pnpm-fetch-modules"
      local pnpm_log="$TMPDIR/${label}-reconcile.log"
      set +e
      timeout "$IT"s env CI="1" NODE_OPTIONS="--no-warnings" PNPM_HOME="$PNPM_HOME" "$PNPM_BIN" fetch \
        --frozen-lockfile \
        --ignore-scripts \
        --ignore-pnpmfile \
        --prefer-offline \
        --network-concurrency 1 \
        --child-concurrency 1 \
        --prod=false \
        --lockfile-dir "." \
        --dir "." \
        --store-dir "$out/store" \
        --modules-dir "$modules_dir" \
        --virtual-store-dir "$modules_dir/.pnpm" \
        --package-import-method hardlink \
        --reporter=append-only \
        --color never \
        $PNPM_TRUST_LOCKFILE_ARG >"$pnpm_log" 2>&1
      local status="$?"
      set -e
      if [ "$status" -ne 0 ]; then
        echo "[nix] ${label}: fixed-store reconciliation failed with status $status" >&2
        cat "$pnpm_log" >&2 || true
        exit "$status"
      fi
      rm -rf "$modules_dir" node_modules
      local populated=""
      for files_dir in "$out/store"/v*/files; do
        if [ -d "$files_dir" ] && find "$files_dir" -type f -print -quit | grep -q .; then
          populated=1
          break
        fi
      done
      if [ -z "$populated" ]; then
        if yq -e '((.packages // {}) | keys | map(select(test("(^|@)(file|link|workspace):") | not)) | length) == 0' pnpm-lock.yaml >/dev/null; then
          echo "[nix] ${label}: lockfile has no registry packages; empty fixed store is valid" >&2
        else
          echo "[nix] ${label}: pnpm fetch produced no content-addressed files for a lockfile with external packages" >&2
          exit 6
        fi
      fi
    }
  '';
  normalizePnpmStoreScript = ''
    normalize_pnpm_store_for_fod() {
      local store_root="$1"
      [ -d "$store_root" ] || return 0
      for index_db in "$store_root"/v*/index.db; do
        [ -f "$index_db" ] || continue
        echo "[nix] pnpm-store: normalizing sqlite index $index_db" >&2
        local normalized_db="$TMPDIR/pnpm-store-index.$$.db"
        local normalized_rows="$TMPDIR/pnpm-store-index.$$.rows"
        local normalized_sql="$TMPDIR/pnpm-store-index.$$.sql"
        rm -f "$normalized_db" "$normalized_rows" "$normalized_sql"
        sqlite3 "file:$index_db?mode=ro&immutable=1" \
          "SELECT hex(CAST(key AS BLOB)) || char(9) || hex(data) FROM package_index ORDER BY key;" \
          > "$normalized_rows"
        node - "$normalized_rows" <<'NODE' > "$normalized_sql"
const fs = require("fs");
const input = process.argv[2];
const minTimestampMs = Date.parse("2020-01-01T00:00:00.000Z");
const maxTimestampMs = Date.parse("2100-01-01T00:00:00.000Z");
const canonicalDouble = Buffer.alloc(8);
canonicalDouble.writeDoubleBE(0, 0);

function normalizePnpmMetadataBlob(hex) {
  const data = Buffer.from(hex, "hex");
  // pnpm v11 stores msgpack metadata blobs in package_index.data. `checkedAt`
  // values are encoded as float64 millisecond timestamps and otherwise make
  // fixed-output pnpm store hashes depend on when the exact store was fetched.
  for (let i = 0; i + 8 < data.length; i += 1) {
    if (data[i] !== 0xcb) continue;
    const value = data.readDoubleBE(i + 1);
    if (Number.isFinite(value) && value >= minTimestampMs && value <= maxTimestampMs) {
      canonicalDouble.copy(data, i + 1);
    }
  }
  return data.toString("hex");
}

console.log("PRAGMA page_size=4096;");
console.log("PRAGMA encoding=\"UTF-8\";");
console.log("CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID;");
for (const line of fs.readFileSync(input, "utf8").trimEnd().split("\n")) {
  if (!line) continue;
  const [keyHex, dataHex] = line.split("\t");
  if (!keyHex || !dataHex) throw new Error("malformed package_index row: " + line);
  const normalizedDataHex = normalizePnpmMetadataBlob(dataHex);
  console.log(
    "INSERT INTO package_index(key,data) VALUES(CAST(X'" +
      keyHex +
      "' AS TEXT),X'" +
      normalizedDataHex +
      "');",
  );
}
NODE
        sqlite3 "$normalized_db" < "$normalized_sql"
        sqlite3 "$normalized_db" 'ANALYZE; VACUUM;'
        cp "$normalized_db" "$index_db"
        node - "$index_db" <<'NODE'
const fs = require("fs");
const indexDb = process.argv[2];
const fd = fs.openSync(indexDb, "r+");
try {
  // SQLite header bytes 96..99 identify the library that last wrote the DB.
  fs.writeSync(fd, Buffer.alloc(4), 0, 4, 96);
} finally {
  fs.closeSync(fd);
}
NODE
        rm -f "$normalized_db" "$normalized_rows" "$normalized_sql"
        touch -h -t 197001010000 "$index_db" >/dev/null 2>&1 || true
      done
    }
  '';
  inherit repoRoot repoFsRoot prefetchedStorePathGlobal;
in {
  mkPnpmStore = { lockfilePath, importerDir, npmrcPath ? null, packageJsonPath ? null, prefetchedStorePath ? prefetchedStorePathGlobal }:
    let
      relLock = lockfilePath;
      relLockDir = dirnameOf relLock;
      src = importerOnlySrc { inherit importerDir; lockfilePath = relLock; };
      outHash = hashMap.${relLock} or placeholderDigest;
      lockAbsStrStore = "${repoRoot}/${relLock}";
      lockAbsStrFs = "${repoFsRoot}/${relLock}";
      hasLockFs = builtins.pathExists lockAbsStrFs;
      hasLockStore = builtins.pathExists lockAbsStrStore;
      lockInput = if hasLockFs then (builtins.path { path = lockAbsStrFs; name = "pnpm-lock.yaml"; }) else (if hasLockStore then (builtins.path { path = lockAbsStrStore; name = "pnpm-lock.yaml"; }) else null);
      # Do not use prefetched stores for pnpm-store FODs. They can include extra packages
      # beyond the lockfile, which makes the fixed-output hash unstable.
      preferPrefetch = false;
      prefetchedInput = null;
      # Keep default fetch timeout aligned with update-pnpm-hash/install-deps primary path.
      ftVal = let v = builtins.getEnv "NIX_PNPM_FETCH_TIMEOUT"; in if v != "" then v else "600";
      installTimeoutVal = let v = builtins.getEnv "NIX_PNPM_INSTALL_TIMEOUT"; in if v != "" then v else "1800";
      # A missing lockfile keeps the placeholder digest so evaluation can produce the
      # explicit u repair diagnostic without generating metadata in an artifact build.
      reconcileAllowed = (builtins.getEnv "NIX_PNPM_RECONCILE") == "1";
      materializeAllowed = (builtins.getEnv "NIX_PNPM_MATERIALIZE") == "1";
      fixHashAttrs =
        if (hasLockFs || hasLockStore) then {
          outputHashMode = "recursive";
          outputHash = outHash;
        } else {
          outputHashMode = "recursive";
          outputHash = placeholderDigest;
        };
    in pkgs.stdenvNoCC.mkDerivation ({
      pname = "pnpm-store";
      version = if (hasLockFs || hasLockStore) then "lock-${builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore)}" else "lock-missing";
      inherit src;
      nativeBuildInputs = [ node pnpm nix pkgs.coreutils pkgs.sqlite pkgs.yq-go ];
      # These outputs are package-cache snapshots, not runtime executables, so generic
      # fixup spends time scanning vendored payloads without improving correctness.
      dontFixup = true;
      preferLocalBuild = true;
      allowSubstitutes = false;
      dontPatchShebangs = true;
      unpackPhase = ''
        echo "[nix] mkPnpmStore: unpackPhase begin"
        runHook preUnpack
        cp -r $src source
        chmod -R u+rwX source
        cd source/${importerDir}
        echo "[nix] mkPnpmStore: entered $(pwd)"
        ls -la || true
        runHook postUnpack
        echo "[nix] mkPnpmStore: unpackPhase end"
      '';
      buildPhase = if (prefetchedInput == null) then ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        export SOURCE_DATE_EPOCH=1
        export TZ=UTC
        export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
        export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
        export HOME=$(pwd)/.home
        mkdir -p "$HOME"
        export COREPACK_ENABLE=0
        export COREPACK_ENABLE_AUTO_PIN=0
        export PNPM_HOME="$HOME/.pnpm-home"
        mkdir -p "$PNPM_HOME"
        # Strip packageManager to prevent corepack/pnpm self-bootstrap (relative to importer root)
        node -e 'const fs=require("fs"); const p="package.json"; if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,"utf8")); delete j.packageManager; fs.writeFileSync(p, JSON.stringify(j, null, 2));}'
        # Do NOT generate a lockfile inside this fixed-output derivation. This must be seeded
        # outside the FOD to avoid non-deterministic outputs across runs.
        LOCK_INPUT_PATH="${if lockInput != null then "${lockInput}" else "/nonexistent"}"
        echo "[nix] mkPnpmStore: lockInput=${if lockInput != null then "present" else "absent"} path=$LOCK_INPUT_PATH" >&2
        if [ ! -f pnpm-lock.yaml ] && [ -f "$LOCK_INPUT_PATH" ]; then
          echo "[nix] mkPnpmStore: injecting importer lockfile input from $LOCK_INPUT_PATH" >&2
          cp "$LOCK_INPUT_PATH" pnpm-lock.yaml
        fi
        if [ ! -f pnpm-lock.yaml ]; then
          echo "[nix] mkPnpmStore: no lockfile present for ${relLock}." >&2
          echo "repair: run u" >&2
          exit 4
        fi
        # Force workspace root to current directory. The universal fixed store is
        # the deterministic union of the exact Nix platforms supported below.
        ${pnpmWorkspaceMarkerScript}
        IT="${installTimeoutVal}"
        PNPM_BIN="${pnpm}/bin/pnpm"
        PNPM_TRUST_LOCKFILE_ARG=""
        if "$PNPM_BIN" install --help 2>/dev/null | grep -q -- "--trust-lockfile"; then
          PNPM_TRUST_LOCKFILE_ARG="--trust-lockfile"
        fi
        "$PNPM_BIN" config set store-dir "$out/store"
        if [ "${if reconcileAllowed || materializeAllowed then "1" else "0"}" = "1" ]; then
          ${populatePnpmStoreScript "mkPnpmStore"}
          for supported_architectures in ${lib.escapeShellArgs pnpmSupportedArchitectureMarkers}; do
            write_pnpm_workspace_marker "$supported_architectures"
            populate_pnpm_store
          done
        else
          echo "[nix] mkPnpmStore: final fixed pnpm store is missing." >&2
          echo "repair: run u" >&2
          exit 5
        fi
        echo "[nix] mkPnpmStore: install complete"
        # Normalize store timestamps and scrub volatile JSON fields to stabilize FOD output
        if [ -d "$out/store" ]; then
          echo "[nix] mkPnpmStore: normalizing timestamps in store" >&2
          find "$out/store" -exec touch -h -t 197001010000 {} + >/dev/null 2>&1 || true
          echo "[nix] mkPnpmStore: normalizing modes in store" >&2
          find "$out/store" -type d -exec chmod 755 {} + >/dev/null 2>&1 || true
          find "$out/store" -type f ! -name '*-exec' -exec chmod 644 {} + >/dev/null 2>&1 || true
          find "$out/store" -type f -name '*-exec' -exec chmod 755 {} + >/dev/null 2>&1 || true
          echo "[nix] mkPnpmStore: scrubbing volatile JSON fields" >&2
          OUT_STORE="$out/store" node -e '
            const fs=require("fs"); const path=require("path");
            const root=process.env.OUT_STORE||"";
            function scrub(obj){
              if(!obj||typeof obj!=="object") return;
              delete obj.checkedAt; delete obj.createdAt; delete obj.updatedAt; delete obj.timestamp;
              for (const k of Object.keys(obj)) scrub(obj[k]);
            }
            function walk(d){
              for (const ent of fs.readdirSync(d,{withFileTypes:true})) {
                const p=path.join(d, ent.name);
                if (ent.isDirectory()) walk(p);
                else if (ent.isFile() && ent.name.endsWith(".json")) {
                  try {
                    const txt=fs.readFileSync(p,"utf8");
                    const j=JSON.parse(txt);
                    scrub(j);
                    fs.writeFileSync(p, JSON.stringify(j));
                  } catch {}
                }
              }
            }
            if (root && fs.existsSync(root)) walk(root);
          ' || true
          echo "[nix] mkPnpmStore: removing path-local pnpm project links" >&2
          rm -rf "$out/store"/v*/projects >/dev/null 2>&1 || true
          ${normalizePnpmStoreScript}
          normalize_pnpm_store_for_fod "$out/store"
        fi
        # Export lockfile (if present) so downstream consumers can use it without regenerating
        mkdir -p "$out/lockfile"
        if [ -f pnpm-lock.yaml ]; then
          cp pnpm-lock.yaml "$out/lockfile/pnpm-lock.yaml"
        fi
        runHook postBuild
        if [ "${if reconcileAllowed then "1" else "0"}" = "1" ]; then
          expected_hash=${lib.escapeShellArg outHash}
          actual_hash="$(${nix}/bin/nix hash path --sri "$out")"
          if [ "$actual_hash" != "$expected_hash" ]; then
            chmod -R u+w "$out"
            rm -rf "$out"
            if [ -e "$out" ]; then
              echo "error: failed to remove mismatched fixed-output candidate: $out" >&2
              exit 7
            fi
            echo "viberoots-pnpm-fod-hash-mismatch-v1 output=$out specified=$expected_hash got=$actual_hash" >&2
            exit 1
          fi
        fi
      '' else ''
        runHook preBuild
        # quiet: reduce verbose diagnostics
        mkdir -p "$out/store"
        # Copying avoids embedding references to the prefetched store path in a FOD output
        cp -R ${prefetchedInput}/. "$out/store/"
        echo "[nix] mkPnpmStore: sample of copied store layout"
        (cd "$out/store" && find . -maxdepth 2 -type d | sort | head -n 200) || true
        runHook postBuild
      '';
      passthru = {
        lockHash = if (hasLockFs || hasLockStore) then builtins.hashFile "sha256" (if hasLockFs then lockAbsStrFs else lockAbsStrStore) else "";
      };
    } // fixHashAttrs);
}
