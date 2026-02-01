{ lib
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

  ensureRepoCppLibDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
    in
      if depNode == null then failLinkDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang then failLinkDep consumer dep ("expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if builtins.elem "kind:wasm" labs then failLinkDep consumer dep ("expected kind:lib for Phase 1; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if k != "lib" then failLinkDep consumer dep ("expected kind:lib for Phase 1; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeadersDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
    in
      if depNode == null then failHeaderDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang then failHeaderDep consumer dep ("expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if k != "headers" then failHeaderDep consumer dep ("expected kind:headers for Phase 1; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeaderDepInfo = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      k = if depNode == null then null else kindOf depNode;
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && hasLangCpp depNode;
    in
      if depNode == null then failHeaderDep consumer dep "unknown target (missing from exported graph)"
      else if !haveLang then failHeaderDep consumer dep ("expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if k == "headers" || k == "lib" then { name = dep; kind = k; }
      else failHeaderDep consumer dep ("expected kind:headers or kind:lib for Phase 1; got kind=" + (builtins.toString k) + " labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt));

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


