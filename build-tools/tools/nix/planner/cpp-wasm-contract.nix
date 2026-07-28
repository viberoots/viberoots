{ lib, get, byName, labelsOf }:
let
  value = node: field:
    let found = get node field;
    in if found == null then "" else builtins.toString found;
  normalizeTarget = abi: target:
    if abi == "wasi" && target == "wasm32-wasi" then "wasm32-wasip1" else target;
in {
  validateDirectDependencies = name:
    let
      consumer = byName.${name};
      dependenciesRaw = get consumer "link_deps";
      dependencies = if dependenciesRaw == null then [] else dependenciesRaw;
      consumerAbi = value consumer "wasm_abi";
      consumerTarget = normalizeTarget consumerAbi (value consumer "wasm_target");
      consumerLibc = value consumer "wasm_libc";
      validate = dependency:
        let
          producer = byName.${dependency} or {};
          labels = labelsOf producer;
          supported = builtins.elem "kind:wasm" labels
            && builtins.elem "wasm:static" labels
            && builtins.any (label: builtins.elem label labels)
              [ "lang:cpp" "lang:go" "lang:rust" ];
          abi = value producer "wasm_abi";
          target = normalizeTarget abi (value producer "wasm_target");
          allocator = value producer "wasm_allocator";
          libc = value producer "wasm_libc";
          exception = value producer "wasm_exception_policy";
          runtime = value producer "wasm_runtime";
          tinyGoWasi = builtins.elem "lang:go" labels && abi == "wasi";
        in if !supported then builtins.throw
          "C++ WASM link ${name} -> ${dependency} requires a typed C++, TinyGo, or Rust static WASM producer"
        else if tinyGoWasi then builtins.throw
          "C++ WASM link ${name} -> ${dependency} uses an unsupported TinyGo WASI static archive with conflicting allocator authority"
        else if abi != consumerAbi || target != consumerTarget then builtins.throw
          "C++ WASM link ${name} -> ${dependency} has incompatible ABI/target ${abi}/${target}; expected ${consumerAbi}/${consumerTarget}"
        else if !(builtins.elem allocator [ "none" "rust" "tinygo" ]) then builtins.throw
          "C++ WASM link ${name} -> ${dependency} has incompatible allocator authority ${allocator}"
        else if libc != consumerLibc then builtins.throw
          "C++ WASM link ${name} -> ${dependency} has incompatible libc authority ${libc}; expected ${consumerLibc}"
        else if !(builtins.elem exception [ "none" "trap" ]) then builtins.throw
          "C++ WASM link ${name} -> ${dependency} has incompatible exception authority ${exception}"
        else if runtime != "link-only" then builtins.throw
          "C++ WASM link ${name} -> ${dependency} has incompatible runtime authority ${runtime}"
        else true;
    in builtins.all validate dependencies;
}
