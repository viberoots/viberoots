{ lib, kind, wasm }:
lib.optionals (builtins.elem kind [ "wasm_static" "wasi_static" ]) [
  "-C"
  "debuginfo=${if wasm.debug then "2" else "0"}"
  "-C"
  "opt-level=${if wasm.optimize == "speed" then "2" else if wasm.optimize == "size" then "z" else "0"}"
]
