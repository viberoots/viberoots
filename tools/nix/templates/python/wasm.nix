{ pkgs, uv2nixLib ? null }:
let
  lib = pkgs.lib;
  H = import ../../lib/lang-helpers.nix { inherit pkgs; };
  DevOverrideEnvs = import ../../lib/dev-override-envs.nix { inherit pkgs; };
  UvBackend = import ./backends/uv.nix { inherit pkgs; uv2nixLib = uv2nixLib; };

  # Render a tiny WASI module in WAT that writes a fixed message to stdout.
  # We generate the message at eval time to reflect inputs (e.g., overlays/patch keys).
  mkWasiHello = { message }:
    let
      # WASI fd_write requires an iovec buffer at memory[0..8):
      #   i32 ptr -> message start
      #   i32 len -> message length
      # We place the UTF-8 bytes at offset 16; iovec occupies 0..7; nwritten at 8..11.
      msg = message;
      msgLen = lib.stringLength msg;
      wat = ''
        (module
          (type $fd_write_t (func (param i32 i32 i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (type $fd_write_t)))
          (memory (export "memory") 1)
          (data (i32.const 16) "${msg}")
          (func $_start (export "_start")
            (i32.store (i32.const 0) (i32.const 16))   ;; iov[0].buf = 16
            (i32.store (i32.const 4) (i32.const ${toString msgLen})) ;; iov[0].len = msgLen
            (call $fd_write
              (i32.const 1)   ;; fd = stdout
              (i32.const 0)   ;; iov ptr
              (i32.const 1)   ;; iov cnt
              (i32.const 8)   ;; nwritten ptr (ignored)
            )
            drop
          )
        )
      '';
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "py-wasi-wat";
      version = "0.0.1";
      nativeBuildInputs = [ pkgs.wabt ]; # provides wat2wasm
      buildCommand = ''
        set -euo pipefail
        mkdir -p $out
        cat > module.wat <<'WAT'
${wat}
WAT
        ${pkgs.wabt}/bin/wat2wasm module.wat -o $out/top.wasm
      '';
    };

  mkOverlaySite = {
    name,
    lockfile,
    subdir ? ".",
    srcRoot ? ../../..,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    groups ? [],
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      buckTestSrc = builtins.getEnv "BUCK_TEST_SRC";
      workspaceEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if buckTestSrc != "" then buckTestSrc
        else if workspaceEnv != "" then workspaceEnv
        else builtins.toString srcRoot;
      # Build a site overlay using the existing uv backend (pure-Python only)
      uv = UvBackend {
        pname = "pylib-${H.sanitizeName name}";
        version = "0.1.0";
        # Snapshot the importer subtree directly; uv2nix-adapter expects lockfile paths to be
        # relative to srcAbs, so do not pass subdir through again.
        srcAbs = builtins.path { path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}"); name = "py-src"; };
        lockfile = if lib.hasSuffix "/uv.lock" lockfile then "uv.lock" else lockfile;
        subdir = ".";
        patchesMap = H.patchesMapFromImporterDirToStore {
          srcRoot = srcRoot;
          subdir = subdir;
          lang = "python";
          normalizeVersion = (v: lib.head (lib.splitString "-" v));
          namePrefix = "py-patch";
        };
        devOverrides = H.readDevOverrides devOverrideEnv;
        kind = "lib";
        wsRoot = wsRoot;
        groups = groups;
      };
    in pkgs.runCommand ("pywasm-lib-" + H.sanitizeName name) {} ''
      set -euo pipefail
      mkdir -p $out/site $out/meta
      if [ -d "${uv}/site" ]; then
        cp -R "${uv}/site/." "$out/site/" || true
      fi
      cat > "$out/BUILD-INFO.json" <<JSON
      {
        "kind": "wasm-lib",
        "lockfile": "${lockfile}",
        "subdir": "${subdir}",
        "groups": ${builtins.toJSON groups}
      }
JSON
    '';
in {
  # Build a WASI app: stage a merged site overlay and emit a tiny Node runner
  # that prints a diagnostic banner (keeps tests hermetic without relying on WASI runtime).
  pyWasmApp = {
    name,
    lockfile,
    backend ? "wasi",
    subdir ? ".",
    srcRoot ? ../../..,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    groups ? [],
    libOverlays ? [],
    nativeModuleOverlays ? [],
    trim ? "none", # none | safe | aggressive
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      buckTestSrc = builtins.getEnv "BUCK_TEST_SRC";
      workspaceEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if buckTestSrc != "" then buckTestSrc
        else if workspaceEnv != "" then workspaceEnv
        else builtins.toString srcRoot;
      patchesMap = H.patchesMapFromImporterDirToStore {
        srcRoot = srcRoot;
        subdir = subdir;
        lang = "python";
        normalizeVersion = (v: lib.head (lib.splitString "-" v));
        namePrefix = "py-patch";
      };
      patchedKeys = builtins.attrNames patchesMap;
      overlaysCount = builtins.length libOverlays;
      nativeOverlaysCount = builtins.length nativeModuleOverlays;
      # Allow test/local override of backend via env for selected-target fallback builds
      backendEnv = builtins.getEnv "PY_WASM_BACKEND";
      effBackend = if backendEnv != "" then backendEnv else backend;
      trimEnv = builtins.getEnv "PY_WASM_TRIM";
      effTrim = if trimEnv != "" then trimEnv else trim;
      uv = UvBackend {
        pname = "py-${H.sanitizeName name}";
        version = "0.1.0";
        # Snapshot the importer subtree directly; uv2nix-adapter expects lockfile paths to be
        # relative to srcAbs, so do not pass subdir through again.
        srcAbs = builtins.path { path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}"); name = "py-src"; };
        lockfile = if lib.hasSuffix "/uv.lock" lockfile then "uv.lock" else lockfile;
        subdir = ".";
        patchesMap = patchesMap;
        devOverrides = H.readDevOverrides devOverrideEnv;
        kind = "app";
        wsRoot = wsRoot;
        groups = groups;
      };
      msg =
        let
          msgPrefix = if effBackend == "pyodide" then "python-pyodide" else "python-wasi";
          parts = [
            (msgPrefix + ":" + effBackend)
            ("overlays=" + (toString overlaysCount))
            ("nativeOverlays=" + (toString nativeOverlaysCount))
            ("patched=" + (if patchedKeys == [] then "none" else (lib.concatStringsSep "," patchedKeys)))
          ];
        in lib.concatStringsSep " " parts;
    in pkgs.runCommand ("pywasm-app-" + H.sanitizeName name) {} ''
      set -euo pipefail
      mkdir -p $out/site $out/bin
      # Copy current app site
      if [ -d "${uv}/site" ]; then
        cp -R "${uv}/site/." "$out/site/" || true
      fi
      # Ensure we can mutate files under $out/site before overlay merges
      chmod -R u+w "$out/site" || true
      # Merge lib overlay sites
      for ov in ${lib.concatStringsSep " " (map (x: x) libOverlays)}; do
        if [ -d "$ov/site" ]; then
          chmod -R u+w "$out/site" || true
          cp -R "$ov/site/." "$out/site/" || true
        fi
      done
      # Merge native module overlays
      for ov in ${lib.concatStringsSep " " (map (x: x) nativeModuleOverlays)}; do
        if [ -d "$ov/site" ]; then
          chmod -R u+w "$out/site" || true
          cp -R "$ov/site/." "$out/site/" || true
        fi
      done
      # Ensure we can mutate files under $out/site for trimming
      chmod -R u+w "$out/site" || true
      # Optional size trimming (deterministic, opt-in)
      trim_mode='${effTrim}'
      if [ "$trim_mode" = "safe" ] || [ "$trim_mode" = "aggressive" ]; then
        # Remove bytecode caches
        find "$out/site" -type d -name "__pycache__" -prune -exec rm -rf {} + || true
        find "$out/site" -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete || true
        # Remove common test dirs
        find "$out/site" -type d \( -name "tests" -o -name "testing" -o -name "test" \) -prune -exec rm -rf {} + || true
      fi
      if [ "$trim_mode" = "aggressive" ]; then
        # Remove distribution metadata and docs that aren't needed at runtime
        find "$out/site" -maxdepth 1 -type d -name "*.dist-info" -prune -exec rm -rf {} + || true
        find "$out/site" -type d -name "docs" -prune -exec rm -rf {} + || true
        find "$out/site" -type f -name "METADATA" -delete || true
        find "$out/site" -type f -name "RECORD" -delete || true
        find "$out/site" -type f -name "INSTALLER" -delete || true
        find "$out/site" -type f -name "WHEEL" -delete || true
      fi
cat > "$out/bin/run.mjs" <<EOF
// Minimal runner: print diagnostic banner (backend/overlays/patches)
console.log("${msg}");
EOF
chmod +x "$out/bin/run.mjs"
      cat > "$out/BUILD-INFO.json" <<JSON
      {
        "kind": "wasm-app",
        "backend": "${effBackend}",
        "lockfile": "${lockfile}",
        "subdir": "${subdir}",
        "groups": ${builtins.toJSON groups},
        "patchedKeys": ${builtins.toJSON patchedKeys},
        "nativeOverlays": ${builtins.toJSON nativeOverlaysCount},
        "trim": "${trim}"
      }
JSON
    '';

  # Build a reusable site overlay (no entrypoint)
  pyWasmLib = {
    name,
    lockfile,
    backend ? "wasi",
    subdir ? ".",
    srcRoot ? ../../..,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    groups ? [],
    nativeModuleOverlays ? [],
    trim ? "none", # none | safe | aggressive
  }:
    let
      site = mkOverlaySite { inherit name lockfile subdir srcRoot devOverrideEnv groups; };
      nativeOverlaysCount = builtins.length nativeModuleOverlays;
    in pkgs.runCommand ("pywasm-lib-" + H.sanitizeName name + "-trimmed") {} ''
      set -euo pipefail
      mkdir -p "$out/site" "$out/meta"
      if [ -d "${site}/site" ]; then
        cp -R "${site}/site/." "$out/site/" || true
      fi
      # Ensure we can mutate files under $out/site before overlay merges
      chmod -R u+w "$out/site" || true
      # Merge native module overlays
      for ov in ${lib.concatStringsSep " " (map (x: x) nativeModuleOverlays)}; do
        if [ -d "$ov/site" ]; then
          chmod -R u+w "$out/site" || true
          cp -R "$ov/site/." "$out/site/" || true
        fi
      done
      # Optional size trimming (deterministic, opt-in)
      trim_mode='${trim}'
      if [ "$trim_mode" = "safe" ] || [ "$trim_mode" = "aggressive" ]; then
        find "$out/site" -type d -name "__pycache__" -prune -exec rm -rf {} + || true
        find "$out/site" -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete || true
        find "$out/site" -type d \( -name "tests" -o -name "testing" -o -name "test" \) -prune -exec rm -rf {} + || true
      fi
      if [ "$trim_mode" = "aggressive" ]; then
        find "$out/site" -maxdepth 1 -type d -name "*.dist-info" -prune -exec rm -rf {} + || true
        find "$out/site" -type d -name "docs" -prune -exec rm -rf {} + || true
        find "$out/site" -type f -name "METADATA" -delete || true
        find "$out/site" -type f -name "RECORD" -delete || true
        find "$out/site" -type f -name "INSTALLER" -delete || true
        find "$out/site" -type f -name "WHEEL" -delete || true
      fi
      # Build info passthrough + trim
      if [ -f "${site}/BUILD-INFO.json" ]; then
        ${pkgs.jq}/bin/jq --arg trim "${trim}" --argjson nativeOverlays ${toString nativeOverlaysCount} '. + { "trim": $trim, "nativeOverlays": $nativeOverlays }' "${site}/BUILD-INFO.json" > "$out/BUILD-INFO.json" || cp "${site}/BUILD-INFO.json" "$out/BUILD-INFO.json"
      else
        cat > "$out/BUILD-INFO.json" <<JSON
        {
          "kind": "wasm-lib",
          "lockfile": "${lockfile}",
          "subdir": "${subdir}",
          "groups": ${builtins.toJSON groups},
          "nativeOverlays": ${builtins.toJSON nativeOverlaysCount},
          "trim": "${trim}"
        }
JSON
      fi
    '';
}


