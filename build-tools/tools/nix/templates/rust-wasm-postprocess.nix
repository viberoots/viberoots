{
  pkgs,
  wasmtimePkgs ? pkgs,
  rustToolchain ? pkgs.viberootsRustToolchain,
  rustPlatform ? pkgs.viberootsRustPlatform,
  lib,
  kind,
  crate,
  wasm,
}:
let
  Tools = import ./rust-wasm-tools.nix {
    inherit pkgs wasmtimePkgs rustToolchain rustPlatform;
  };
  wasmTools = "${Tools.wasmTools}/bin/wasm-tools";
  wasmBindgen = "${Tools.wasmBindgen}/bin/wasm-bindgen";
  Controls = import ./rust-wasm-controls.nix { inherit pkgs lib Tools kind wasm; };
  wasmOpt = "${Tools.wasmOpt}/bin/wasm-opt";
  wasmtime = "${Tools.wasmtime}/bin/wasmtime";
  adapter = wasm.adapter or "none";
  core = "$out/lib/${crate}.wasm";
  adapterPath =
    if adapter == "wasi-preview1-reactor"
    then "${Tools.adapters.reactor}/share/wasi_snapshot_preview1.reactor.wasm"
    else if adapter == "wasi-preview1-command"
    then "${Tools.adapters.command}/share/wasi_snapshot_preview1.command.wasm"
    else "";
  browser = ''
    mkdir -p "$out/pkg"
    ${wasmBindgen} ${core} --target web --typescript \
      ${lib.optionalString wasm.debug "--debug --keep-debug"} \
      --out-dir "$out/pkg" --out-name ${lib.escapeShellArg crate}
    ${Controls.processBrowser "$out/pkg/${crate}_bg.wasm"}
    cat > "$out/pkg/package.json" <<'JSON'
    ${builtins.toJSON {
      name = crate;
      version = "0.1.0";
      type = "module";
      module = "./${crate}.js";
      types = "./${crate}.d.ts";
      files = [ "${crate}.js" "${crate}.d.ts" "${crate}_bg.wasm" "browser-harness.html" ]
        ++ lib.optional wasm.sourceMap "${crate}_bg.wasm.map";
    }}
    JSON
    cat > "$out/pkg/browser-harness.html" <<'HTML'
    <!doctype html>
    <meta charset="utf-8">
    <script type="module">
      import init, * as bindings from "./${crate}.js";
      await init();
      document.documentElement.dataset.viberootsWasm = "ready";
      const query = new URLSearchParams(location.search);
      const probe = query.get("viberootsProbe");
      if (probe) {
        const callable = bindings[probe];
        if (typeof callable !== "function") throw new Error(`unknown WASM probe: ''${probe}`);
        const args = JSON.parse(query.get("viberootsArgs") || "[]");
        const result = await callable(...args);
        document.documentElement.dataset.viberootsResult = JSON.stringify(result);
        const report = query.get("viberootsReport");
        if (report) {
          await fetch(report, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ probe, result }),
          });
        }
      }
    </script>
    HTML
  '';
  component = ''
    ${Controls.enforceWitExports wasm.wit false}
    embedded="$TMPDIR/${crate}.embedded.wasm"
    cp ${core} "$embedded"
    ${Controls.processComponentCore "$embedded"}
    ${wasmTools} component embed ${wasm.wit} --world ${lib.escapeShellArg wasm.world} \
      "$embedded" -o "$embedded.wit"
    adapter_args=()
    ${lib.optionalString (adapterPath != "") ''
      adapter_args+=(--adapt "wasi_snapshot_preview1=${adapterPath}")
    ''}
    ${wasmTools} component new "$embedded.wit" "''${adapter_args[@]}" \
      -o "$out/lib/${crate}.component.wasm"
    ${wasmTools} validate --features component-model \
      "$out/lib/${crate}.component.wasm"
    ${wasmTools} component wit "$out/lib/${crate}.component.wasm" \
      > "$out/lib/${crate}.component.wit"
    ${Controls.enforceWitExports "$out/lib/${crate}.component.wit" true}
  '';
  metadata = ''
    mkdir -p "$out/share/viberoots-rust"
    cat > "$out/share/viberoots-rust/wasm-manifest.json" <<'JSON'
    ${builtins.toJSON {
      schemaVersion = "viberoots.rust-wasm.v1";
      inherit (wasm) abi target linkKind allocator exceptionPolicy runtime
        libc exported optimize debug sourceMap world adapter moduleSurface;
      tools = {
        wasmBindgen = builtins.toString Tools.wasmBindgen;
        wasmTools = builtins.toString Tools.wasmTools;
        wasmOpt = builtins.toString Tools.wasmOpt;
        wasmtime = builtins.toString Tools.wasmtime;
        llvm = builtins.toString pkgs.llvmPackages.llvm;
        jq = builtins.toString pkgs.jq;
        rustToolchain = builtins.toString rustToolchain;
        adapter = adapterPath;
      } // lib.optionalAttrs (kind == "wasm_browser") {
        browserEngine = builtins.toString Tools.browserEngine;
        browserExecutable = Tools.browserExecutable;
      };
      controlStage = if builtins.elem kind [ "wasm_static" "wasi_static" ]
        then "rustc-relocatable-members"
        else if kind == "wasm_component" then "pre-component-core"
        else "final-module";
      controlScope = if kind == "wasm_static" || kind == "wasi_static"
        then "rustc-opt-and-debuginfo"
        else if kind == "wasm_component" then "wit-world-and-core"
        else "core-exports-and-debug-sections";
      compilePolicy = {
        debuginfo = if wasm.debug then "2" else "0";
        optLevel = if kind == "wasm_static" || kind == "wasi_static"
          then (if wasm.optimize == "speed" then "2"
            else if wasm.optimize == "size" then "z" else "0")
          else "cargo-profile";
      };
    }}
    JSON
  '';
  corePostprocess = lib.optionalString (
    wasm != {} && !builtins.elem kind [ "wasm_static" "wasi_static" "wasm_browser" "wasm_component" ]
  ) ''
    ${Controls.processCore core}
  '';
in {
  buildInputs = lib.optionals (wasm != {}) [
    Tools.wasmBindgen
    Tools.wasmTools
    Tools.wasmOpt
    Tools.wasmtime
  ] ++ lib.optionals (adapter == "wasi-preview1-reactor") [ Tools.adapters.reactor ]
    ++ lib.optionals (adapter == "wasi-preview1-command") [ Tools.adapters.command ]
    ++ lib.optionals (kind == "wasm_browser") [ Tools.browserEngine ];
  install = corePostprocess
    + lib.optionalString (kind == "wasm_browser") browser
    + lib.optionalString (kind == "wasm_component") component
    + lib.optionalString (wasm != {}) metadata;
  passthru = {
    inherit adapterPath;
    toolIdentities = if wasm == {} then {} else {
      wasmBindgen = builtins.toString Tools.wasmBindgen;
      wasmTools = builtins.toString Tools.wasmTools;
      wasmOpt = builtins.toString Tools.wasmOpt;
      wasmtime = builtins.toString Tools.wasmtime;
      llvm = builtins.toString pkgs.llvmPackages.llvm;
      jq = builtins.toString pkgs.jq;
      rustToolchain = builtins.toString rustToolchain;
    } // lib.optionalAttrs (kind == "wasm_browser") {
      browserEngine = builtins.toString Tools.browserEngine;
      browserExecutable = Tools.browserExecutable;
    };
  };
}
