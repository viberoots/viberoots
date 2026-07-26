{ lib }:
{
  validateKindTarget = kind: target:
    let
      expected =
        if kind == "wasm" then "wasm32-unknown-unknown"
        else if kind == "wasi" then "wasm32-wasip1"
        else "";
    in if target == expected then target else builtins.throw
      "Rust template kind ${kind} requires target ${if expected == "" then "<empty>" else expected}; got ${if target == "" then "<empty>" else target}";

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
}
