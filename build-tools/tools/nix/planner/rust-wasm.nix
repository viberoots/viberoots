{ lib, P, ctx, nodeFor, normalizeList }:
let
  clean = P.cleanLabel;
  LC = import ./link-closure.nix { inherit lib; };
  byName = builtins.listToAttrs (map (node: {
    name = clean (P.nameOf node);
    value = node;
  }) ctx.nodes);
  value = node: field: fallback:
    let found = ctx.get node field;
    in if found == null || found == "" then fallback else found;
  abiTarget = abi:
    if abi == "bare" then "wasm32-unknown-unknown"
    else if abi == "wasi" then "wasm32-wasip1"
    else builtins.throw "Rust WASM ABI must be bare or wasi; got ${abi}";
  sanitizeName = value:
    lib.replaceStrings [ "//" ":" "/" " " ] [ "" "-" "-" "-" ] value;
  dependencyContract = label:
    let
      node = nodeFor label;
      labels = P.labelsOf node;
      cpp = builtins.elem "lang:cpp" labels
        && builtins.elem "kind:wasm" labels
        && builtins.elem "wasm:static" labels;
      go = builtins.elem "lang:go" labels
        && value node "wasm_link_kind" "" == "static";
      rust = builtins.elem "lang:rust" labels
        && value node "wasm_link_kind" "" == "static";
      abi = if builtins.elem "wasm:wasi" labels
        || value node "wasm_abi" "" == "wasi" then "wasi" else "bare";
      expectedTarget = abiTarget abi;
      claimedTarget = value node "wasm_target" "";
      validClaimedTarget = claimedTarget == expectedTarget
        || (cpp && abi == "wasi" && claimedTarget == "wasm32-wasi");
    in if !(cpp || go || rust) then builtins.throw
      "Rust WASM link dependency ${label} must be a C++, TinyGo, or Rust static WASM library"
    else if go && abi == "wasi" then builtins.throw
      "Rust WASM link dependency ${label} uses an unsupported TinyGo WASI static archive with conflicting allocator authority"
    else if !validClaimedTarget then builtins.throw
      "Rust WASM link dependency ${label} ABI ${abi} has incompatible target ${claimedTarget}"
    else {
      inherit label abi;
      linkName = if cpp then sanitizeName label
        else if go then builtins.elemAt (lib.splitString ":" label) 1
        else value node "public_crate" (value node "crate" "");
      target = expectedTarget;
      allocator = value node "wasm_allocator" "";
      libc = value node "wasm_libc" "";
      exceptionPolicy = value node "wasm_exception_policy" "";
      runtime = value node "wasm_runtime" "";
    };
  linkDepsOf = label:
    normalizeList "link_deps for ${label}" (ctx.get (nodeFor label) "link_deps");
in rec {
  isWasmKind = kind: builtins.elem kind [
    "wasm"
    "wasi"
    "wasm_static"
    "wasi_static"
    "wasm_browser"
    "wasm_component"
  ];

  contractFor = name: kind:
    let
      node = nodeFor name;
      abi = value node "wasm_abi" "";
      target = value node "wasm_target" "";
      expected = abiTarget abi;
      linkKind = value node "wasm_link_kind" "";
      expectedLinkKind = {
        wasm = "module";
        wasi = "module";
        wasm_static = "static";
        wasi_static = "static";
        wasm_browser = "browser";
        wasm_component = "component";
      }.${kind} or "";
      exported = normalizeList "exported_functions" (ctx.get node "exported_functions");
      debugRaw = ctx.get node "wasm_debug";
      sourceMapRaw = ctx.get node "wasm_source_map";
    in if !isWasmKind kind then {}
    else if target != expected then builtins.throw
      "Rust WASM target ${name} ABI ${abi} requires ${expected}; got ${target}"
    else if linkKind != expectedLinkKind then builtins.throw
      "Rust WASM target ${name} kind ${kind} requires link kind ${expectedLinkKind}; got ${linkKind}"
    else {
      inherit abi target linkKind exported;
      allocator = value node "wasm_allocator" "";
      libc = value node "wasm_libc" "";
      exceptionPolicy = value node "wasm_exception_policy" "";
      runtime = value node "wasm_runtime" "";
      optimize = value node "wasm_optimize" "none";
      debug = if debugRaw == null then false else debugRaw;
      sourceMap = if sourceMapRaw == null then false else sourceMapRaw;
      header = ctx.get node "wasm_header";
      wit = ctx.get node "wit";
      world = value node "wit_world" "";
      adapter = value node "component_adapter" "none";
      moduleSurface = value node "module_surface" "";
    };

  inputsFor = name: kind:
    let
      node = nodeFor name;
      consumer = contractFor name kind;
      roots = normalizeList "link_deps" (ctx.get node "link_deps");
      closureRaw = ctx.get node "link_closure";
      closure = if closureRaw == null then "direct" else closureRaw;
      overridesRaw = ctx.get node "link_closure_overrides";
      overrides = if overridesRaw == null then {} else builtins.listToAttrs
        (map (key: { name = clean key; value = overridesRaw.${key}; })
          (builtins.attrNames overridesRaw));
      resolved = LC.resolveLinkClosure {
        inherit byName overrides;
        roots = roots;
        defaultClosure = closure;
        linkDepsOf = linkDepsOf;
      };
      validate = label:
        let producer = dependencyContract label;
        in if producer.abi != consumer.abi || producer.target != consumer.target
        then builtins.throw
          "Rust WASM link ${name} -> ${label} is incompatible: consumer ${consumer.abi}/${consumer.target}, producer ${producer.abi}/${producer.target}"
        else if !(builtins.elem producer.exceptionPolicy [ "none" "trap" ])
        then builtins.throw
          "Rust WASM link ${name} -> ${label} has unsupported exception policy ${producer.exceptionPolicy}"
        else if !(builtins.elem producer.allocator [ "none" "tinygo" consumer.allocator ])
        then builtins.throw
          "Rust WASM link ${name} -> ${label} has incompatible allocator authority ${producer.allocator}"
        else if producer.libc != consumer.libc
        then builtins.throw
          "Rust WASM link ${name} -> ${label} has incompatible libc authority ${producer.libc}; expected ${consumer.libc}"
        else if producer.runtime != "link-only"
        then builtins.throw
          "Rust WASM link ${name} -> ${label} is not static link-only runtime authority"
        else producer;
      validated = map validate resolved;
    in {
      libraries = map (producer: ctx.dependencyArtifactOf producer.label) validated;
      headers = [];
      labels = resolved;
      linkNames = map (producer: producer.linkName) validated;
    };
}
