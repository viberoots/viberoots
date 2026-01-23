{ lib, ctx, core }:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  L = core.L;
  nodeOfName = core.nodeOfName;
  labelsOf = core.labelsOf;
  labelsOfName = core.labelsOfName;
  cleanLabel = core.cleanLabel;
  srcsOf = core.srcsOf;

  isWasmish = labs:
    builtins.any (l:
      builtins.isString l && (
        l == "kind:wasm" ||
        l == "flavor:wasm" ||
        lib.hasPrefix "wasm:" l
      )
    ) (if labs == null then [] else labs);

  ensureRepoCppLibDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && builtins.elem "lang:cpp" labs;
      haveLib = depNode != null && builtins.elem "kind:lib" labs;
    in
      if depNode == null then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — unknown target (missing from exported graph)")
      else if !haveLang then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if isWasmish labs then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — Python native extensions cannot link wasm producers; got labels=" + (builtins.toString labs))
      else if !haveLib then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — expected kind:lib; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeadersDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && builtins.elem "lang:cpp" labs;
      haveHeaders = depNode != null && builtins.elem "kind:headers" labs;
    in
      if depNode == null then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — unknown target (missing from exported graph)")
      else if !haveLang then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if !haveHeaders then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — expected kind:headers; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  patchInputsFor = name:
    let
      rels0 = builtins.filter (s: lib.hasSuffix ".patch" s) (srcsOf name);
      rels = builtins.filter (s: !(lib.hasInfix "placeholder" s)) rels0;
      pkg = pkgPathOf name;
      toImportedPath = p: builtins.path {
        path = (repoRoot + "/" + pkg + "/" + p);
        name = "patch";
      };
    in builtins.map toImportedPath rels;

  collectNixAttrsFor = name:
    let
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map (l: lib.removePrefix "nixpkg:" l) labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);

  mkCppLib = name:
    T.cppLib {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      srcList = srcsOf name;
      patches = patchInputsFor name;
    };

  mkCppHeaders = name:
    T.cppHeaders {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = srcsOf name;
      patches = patchInputsFor name;
    };
in {
  inherit isWasmish;
  inherit ensureRepoCppLibDep ensureRepoCppHeadersDep;
  inherit patchInputsFor collectNixAttrsFor;
  inherit mkCppLib mkCppHeaders;
}
