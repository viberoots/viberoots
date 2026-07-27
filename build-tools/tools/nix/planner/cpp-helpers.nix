{ ctx
, lib
, get
, cleanLabel
, ensureStringList
, nodeOfName
, kindOf
, labelsOf
, hasLangCpp
, dedupePreserveOrder
, normSrcsOf
, pkgPathOf
, repoRoot
}:
let
  abiFor = node: import ./native-abi.nix {
    pkgs = (ctx.sourcePlanFor node).base_pkgs;
  };
  labelsFromNodeAttr = { name, attr }:
    let
      n = nodeOfName name;
      raw = if n == null then null else get n attr;
      xs = ensureStringList (attr + " for " + name) raw;
    in builtins.map cleanLabel xs;

  failLinkDep = consumer: dep: msg:
    builtins.throw ("cpp planner: link_deps for " + consumer + " contains " + dep + " — " + msg);

  failHeaderDep = consumer: dep: msg:
    builtins.throw ("cpp planner: header_deps for " + consumer + " contains " + dep + " — " + msg);

  requireInteropEqual = consumer: dep: field: left: right:
    if left == right then true else builtins.throw
      "C++ consumer ${consumer} and Rust bridge ${dep} have mismatched ${field}: ${builtins.toJSON left} != ${builtins.toJSON right}";
  validateRustBridge = consumer: dep: depNode:
    let
      consumerNode = nodeOfName consumer;
      value = node: field: fallback:
        let found = get node field; in if found == null || found == "" then fallback else found;
      kind = value depNode "interop_kind" "";
      standard = if kind == "cxx" then "c++17" else "c11";
      expectedStl = if kind == "cxx" then "libc++" else "none";
      checks = [
        (requireInteropEqual consumer dep "module_surface" (value depNode "module_surface" "")
          "rust-abi:v1:${kind}:${value depNode "link_mode" "static"}:native")
        (requireInteropEqual consumer dep "nixpkgs_profile" (value consumerNode "nixpkgs_profile" "default") (value depNode "nixpkgs_profile" "default"))
        (requireInteropEqual consumer dep "nixpkg_pins" (value consumerNode "nixpkg_pins" {}) (value depNode "nixpkg_pins" {}))
        (requireInteropEqual consumer dep "compiler_family" (value consumerNode "compiler_family" "llvm") (value depNode "compiler_family" "llvm"))
        (requireInteropEqual consumer dep "compiler_identity"
          ((abiFor consumerNode).resolveCompilerIdentity consumer (value consumerNode "compiler_identity" ""))
          ((abiFor depNode).resolveCompilerIdentity dep (value depNode "compiler_identity" "")))
        (requireInteropEqual consumer dep "target_triple"
          ((abiFor consumerNode).resolveTargetTriple consumer (value consumerNode "target_triple" ""))
          ((abiFor depNode).resolveTargetTriple dep (value depNode "target_triple" "")))
        (requireInteropEqual consumer dep "language_standard" (value consumerNode "language_standard" standard)
          (value depNode (if kind == "cxx" then "cxx_standard" else "c_standard") standard))
        (requireInteropEqual consumer dep "stl" (value consumerNode "stl" expectedStl) (value depNode "stl" expectedStl))
      ];
    in if builtins.all (check: check) checks then dep else dep;

  ensureRepoCppLibDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
      haveRustBridge = depNode != null
        && builtins.elem "lang:rust" labs
        && builtins.elem "kind:lib" labs
        && (builtins.elem "rust-interop:c" labs || builtins.elem "rust-interop:cxx" labs)
        && (builtins.elem "crate-type:staticlib" labs || builtins.elem "crate-type:cdylib" labs);
    in
      if depNode == null then failLinkDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang && !haveRustBridge then failLinkDep consumer dep ("expected lang:cpp or a generated Rust C/C++ bridge library; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if haveRustBridge then validateRustBridge consumer dep depNode
      else if builtins.elem "kind:wasm" labs then failLinkDep consumer dep ("expected kind:lib for C++ helper contract; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if k != "lib" then failLinkDep consumer dep ("expected kind:lib for C++ helper contract; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeadersDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
      haveRustBridge = depNode != null
        && builtins.elem "lang:rust" labs
        && builtins.elem "kind:lib" labs
        && (builtins.elem "rust-interop:c" labs || builtins.elem "rust-interop:cxx" labs);
    in
      if depNode == null then failHeaderDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang && !haveRustBridge then failHeaderDep consumer dep ("expected lang:cpp or a generated Rust bridge; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if haveRustBridge then validateRustBridge consumer dep depNode
      else if k != "headers" then failHeaderDep consumer dep ("expected kind:headers for C++ helper contract; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeaderDepInfo = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
      haveRustBridge = depNode != null
        && builtins.elem "lang:rust" labs
        && builtins.elem "kind:lib" labs
        && (builtins.elem "rust-interop:c" labs || builtins.elem "rust-interop:cxx" labs);
    in
      if depNode == null then failHeaderDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang && !haveRustBridge then failHeaderDep consumer dep ("expected lang:cpp or a generated Rust bridge; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if haveRustBridge then assert validateRustBridge consumer dep depNode == dep; { name = dep; kind = "artifact"; }
      else if k == "headers" || k == "lib" then { name = dep; kind = k; }
      else failHeaderDep consumer dep ("expected kind:headers or kind:lib for C++ helper contract; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt));

  patchInputsFor = name:
    let
      rels0 = builtins.filter (s: lib.hasSuffix ".patch" s) (normSrcsOf name);
      rels = builtins.filter (s: !(lib.hasInfix "placeholder" s)) rels0;
      pkg = pkgPathOf name;
      toImportedPath = p: builtins.path {
        path = (repoRoot + "/" + pkg + "/" + p);
        name = "patch";
      };
    in builtins.map toImportedPath rels;
in {
  inherit
    labelsFromNodeAttr
    dedupePreserveOrder
    ensureRepoCppLibDep
    ensureRepoCppHeadersDep
    ensureRepoCppHeaderDepInfo
    patchInputsFor;
}
