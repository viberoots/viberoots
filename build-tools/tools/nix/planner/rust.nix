{ lib }:
ctx:
let
  P = import ./lib.nix { inherit lib; get = ctx.get; };
  clean = P.cleanLabel;
  nodeFor = name:
    let matches = builtins.filter (node: P.nameOf node == clean name) ctx.nodes;
    in if matches == [] then builtins.throw "Rust planner target is absent from graph: ${name}"
       else builtins.head matches;
  packagePath = name: ctx.pkgPathOf (clean name);
  sourcePath = name: value:
    let
      raw = builtins.toString value;
      repositoryPath = if lib.hasPrefix "root//" raw then lib.removePrefix "root//" raw else raw;
    in if lib.hasPrefix "/" raw then builtins.throw "Rust Cargo paths must be repository-relative: ${raw}"
       else if lib.hasInfix "//" repositoryPath then builtins.throw
         "Rust Cargo paths must belong to the root cell: ${raw}"
       else if lib.hasPrefix "projects/" repositoryPath then repositoryPath
       else "${packagePath name}/${repositoryPath}";
  rustNodes = builtins.filter (node: builtins.elem "lang:rust" (P.labelsOf node)) ctx.nodes;
  cargoRootFor = name:
    let
      node = nodeFor name;
      manifest = ctx.get node "cargo_manifest";
      manifestRel = if manifest == null then "" else sourcePath name manifest;
      root = dirOf manifestRel;
      expected = packagePath name;
      canonical = "${expected}/Cargo.toml";
    in if manifest == null then builtins.throw "Rust target ${name} is missing cargo_manifest"
       else if manifestRel != canonical then builtins.throw
         "Rust target ${name} cargo_manifest must be canonical package-local ${canonical}; got ${manifestRel}"
       else if root != expected then builtins.throw
         "Rust target ${name} Cargo root must be package-local at ${expected}; got ${root}"
       else root;
  cargoLockFor = name:
    let
      node = nodeFor name;
      lock = ctx.get node "cargo_lock";
      lockRel = if lock == null then "" else sourcePath name lock;
      canonical = "${packagePath name}/Cargo.lock";
    in if lock == null then builtins.throw "Rust target ${name} is missing cargo_lock"
       else if lockRel != canonical then builtins.throw
         "Rust target ${name} cargo_lock must be canonical package-local ${canonical}; got ${lockRel}"
       else lockRel;
  validatePatchDir = name: value:
    let
      raw = builtins.toString value;
      parts = lib.splitString "/" raw;
      invalidPart = builtins.any (part: part == "" || part == "." || part == "..") parts;
    in if raw == "" || lib.hasPrefix "/" raw || lib.hasInfix "\\" raw || lib.hasInfix ":" raw || invalidPart
       then builtins.throw "Rust target ${name} local_patch_dirs must remain within the package: ${raw}"
       else raw;
  validateDeps = name:
    let
      node = nodeFor name;
      root = cargoRootFor name;
      direct = map clean (P.depsOf node);
      rustDeps = builtins.filter (dep:
        builtins.any (candidate: P.nameOf candidate == dep) rustNodes
      ) direct;
      crossRoot = builtins.filter (dep: cargoRootFor dep != root) rustDeps;
    in if crossRoot == [] then true else builtins.throw
      "Rust target ${name} has unsupported cross-root Rust deps: ${lib.concatStringsSep ", " crossRoot}; declare Cargo path dependencies only within one package-local Cargo root";
  build = kind: name:
    let
      node = nodeFor name;
      rootRel = cargoRootFor name;
      manifestRel = sourcePath name (ctx.get node "cargo_manifest");
      lockRel = cargoLockFor name;
      crate = ctx.get node "crate";
      features = ctx.get node "features";
      defaultFeatures = ctx.get node "default_features";
      profile = ctx.get node "profile";
      target = ctx.get node "target";
      patchDirs = ctx.get node "local_patch_dirs";
      _deps = validateDeps name;
      cargoRoot = builtins.toPath "${ctx.repoRootStr}/${rootRel}";
      cargoManifest = builtins.toPath "${ctx.repoRootStr}/${manifestRel}";
      cargoLock = builtins.toPath "${ctx.repoRootStr}/${lockRel}";
      validatedPatchDirs = map (validatePatchDir name) (if patchDirs == null then [] else patchDirs);
      patchCandidates = map (dir: builtins.toPath "${ctx.repoRootStr}/${rootRel}/${dir}") validatedPatchDirs;
      patchInputs = builtins.filter builtins.pathExists patchCandidates;
    in assert _deps; ctx.T.rustPackage {
      inherit name kind cargoRoot cargoManifest cargoLock patchInputs;
      crate = if crate == null then lib.last (lib.splitString ":" name) else crate;
      features = if features == null then [] else features;
      defaultFeatures = if defaultFeatures == null then true else defaultFeatures;
      profile = if profile == null then "release" else profile;
      target = if target == null then "" else target;
    };
in {
  isTarget = n: P.isTargetByRuleTypeOrLabel {
    ruleTypePrefixes = [ "rust_" ];
    label = "lang:rust";
  } n;

  kindOf = n: P.kindOf {
    labels = P.labelsOf n;
    ruleType = P.ruleTypeOf n;
    name = P.nameOf n;
    config = {
      labelPriorityPre = [
        { label = "kind:bin"; kind = "bin"; }
        { label = "kind:lib"; kind = "lib"; }
      ];
      ruleTypes.suffixes = [
        { suffix = "_binary"; kind = "bin"; }
        { suffix = "_library"; kind = "lib"; }
      ];
    };
  };

  modulesFileFor = _: null;
  mkApp = build "bin";
  mkLib = build "lib";
}
