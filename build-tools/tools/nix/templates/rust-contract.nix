{ lib }:
{
  validateKindTarget = kind: target:
    let
      expected =
        if kind == "wasm"
        then [ "wasm32-unknown-unknown" "wasm32-wasip1" ]
        else if builtins.elem kind [ "wasm_static" "wasm_browser" ]
        then [ "wasm32-unknown-unknown" ]
        else if kind == "wasi" then "wasm32-wasip1"
        else if builtins.elem kind [ "wasi_static" "wasm_component" ] then [ target ]
        else if kind == "pyext_wasm" then [ "wasm32-unknown-emscripten" ]
        else [ "" ];
      allowed = if builtins.isList expected then expected else [ expected ];
      rendered = lib.concatStringsSep " or " (map (value:
        if value == "" then "<empty>" else value) allowed);
    in if builtins.elem target allowed then target else builtins.throw
      "Rust template kind ${kind} requires target ${rendered}; got ${if target == "" then "<empty>" else target}";

  validateWasmTarget = kind: target: wasm:
    if !builtins.elem kind [
      "wasm" "wasi" "wasm_static" "wasi_static" "wasm_browser" "wasm_component"
    ] then true
    else
      let
        abi = wasm.abi or "";
        declared = wasm.target or "";
        expected = if abi == "wasi" then "wasm32-wasip1"
          else if abi == "bare" then "wasm32-unknown-unknown"
          else builtins.throw "Rust template WASM authority requires ABI bare or wasi";
      in if target != expected || declared != expected then builtins.throw
        "Rust template WASM authority ${abi} requires target ${expected}; got target ${target} and manifest target ${declared}"
      else true;

  validateCargoConfigs = roots:
    let
      configs = lib.concatMap (root: builtins.filter builtins.pathExists [
        (root + "/.cargo/config")
        (root + "/.cargo/config.toml")
      ]) roots;
    in if configs == [] then true else builtins.throw
      "Rust Cargo configuration is unsupported because it can replace dependency sources: ${builtins.toString (builtins.head configs)}";

  validateCrateRole = crateType: hostRole: target:
    if !(builtins.elem crateType [ "bin" "rlib" "staticlib" "cdylib" "proc-macro" "test" ])
    then builtins.throw "Rust template unsupported crate type: ${crateType}"
    else if hostRole == "host" && crateType != "proc-macro"
    then builtins.throw "Rust template host role is reserved for proc-macro artifacts"
    else if crateType == "proc-macro" && (hostRole != "host" || target != "")
    then builtins.throw "Rust proc-macro artifacts require the native host toolchain"
    else true;

  validatePublicCrate = publicCrate:
    if !builtins.isString publicCrate
      || builtins.match "[A-Za-z_][A-Za-z0-9_]*" publicCrate == null
    then builtins.throw
      "Rust template publicCrate must match [A-Za-z_][A-Za-z0-9_]*"
    else publicCrate;

  validateExtension = {
    kind,
    module,
    buildPyDeps,
    addonName,
    nodeApiVersion,
    platform,
    pythonAbi,
    selectedPythonAbi,
    selectedNodeApiVersion,
    system,
  }:
    if kind == "pyext_wasm"
      && (module == "" || builtins.match
        "[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)*" module == null)
    then builtins.throw "Rust Python WASM extension module must be a dotted Python identifier"
    else if kind == "pyext"
      && (module == "" || builtins.match
        "[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)*" module == null)
    then builtins.throw "Rust Python extension module must be a dotted Python identifier"
    else if kind == "pyext" && pythonAbi != "selected" && pythonAbi != selectedPythonAbi
    then builtins.throw
      "Rust Python extension ABI ${pythonAbi} does not match selected ${selectedPythonAbi}"
    else if !(builtins.isList buildPyDeps && builtins.all builtins.isString buildPyDeps)
    then builtins.throw "Rust Python extension buildPyDeps must be a list of package names"
    else if kind == "addon"
      && builtins.match "[A-Za-z_][A-Za-z0-9_-]*" addonName == null
    then builtins.throw
      "Rust Node-API addon name must match [A-Za-z_][A-Za-z0-9_-]*"
    else if kind == "addon"
      && !(builtins.elem nodeApiVersion [ 8 9 10 ])
    then builtins.throw
      "Rust Node-API addon version ${builtins.toString nodeApiVersion} is unsupported by the selected Node toolchain (maximum ${builtins.toString selectedNodeApiVersion})"
    else if kind == "addon" && nodeApiVersion > selectedNodeApiVersion
    then builtins.throw
      "Rust Node-API addon version ${builtins.toString nodeApiVersion} exceeds selected Node-API ${builtins.toString selectedNodeApiVersion}"
    else if kind == "addon" && platform != "selected" && platform != system
    then builtins.throw "Rust Node-API addon platform ${platform} does not match selected ${system}"
    else true;
}
