{ lib, P, ctx, nodeFor, rustNodes, clean, packagePath, sourcePath, cargoRootFor, cargoLockFor }:
let
  Semver = import ./rust-semver.nix { inherit lib; };
  rustNames = map (node: clean (P.nameOf node)) rustNodes;
  runtimeDepNames = node:
    let value = ctx.get node "runtime_deps";
    in if value == null then [] else map clean value;
  rustDepNames = node:
    builtins.filter (dep: builtins.elem dep rustNames)
      (builtins.filter
        (dep: !(builtins.elem dep (runtimeDepNames node)))
        (map clean (P.depsOf node)));
  first = values:
    let present = builtins.filter (value: value != null) values;
    in if present == [] then null else builtins.head present;
  pop = values:
    if values == [] then builtins.throw "Rust Cargo path dependency escapes the repository"
    else lib.take ((builtins.length values) - 1) values;
  normalizePath = value:
    lib.concatStringsSep "/" (lib.foldl'
      (parts: part:
        if part == "" || part == "." then parts
        else if part == ".." then pop parts
        else parts ++ [ part ])
      []
      (lib.splitString "/" value));
  resolvePath = root: value: normalizePath "${root}/${value}";
  manifestFor = name:
    builtins.fromTOML (builtins.readFile
      (builtins.toPath "${ctx.repoRootStr}/${sourcePath name (ctx.get (nodeFor name) "cargo_manifest")}"));
  packageFor = name:
    let package = (manifestFor name).package or null;
    in if package == null
       || !(package ? name)
       || !(package ? version)
    then builtins.throw "Rust target ${name} member manifest requires package.name and package.version"
    else package;
  dependencyTables = manifest:
    let
      direct = map (field: manifest.${field} or {}) [
        "dependencies"
        "build-dependencies"
        "dev-dependencies"
      ];
      targetTables = lib.concatMap
        (target: map (field: target.${field} or {}) [
          "dependencies"
          "build-dependencies"
          "dev-dependencies"
        ])
        (builtins.attrValues (manifest.target or {}));
    in direct ++ targetTables;
  pathEntriesFor = name:
    let
      manifest = manifestFor name;
      root = cargoRootFor name;
      entries = lib.concatMap
        (table: map
          (key:
            let value = table.${key};
            in if builtins.isAttrs value && value ? path then {
              inherit key;
              package = value.package or key;
              path = resolvePath root (builtins.toString value.path);
              version = value.version or "";
              features = value.features or [];
              defaultFeatures = value."default-features" or true;
            } else null)
          (builtins.attrNames table))
        (dependencyTables manifest);
    in builtins.filter (entry: entry != null) entries;
  validateEntry = owner: directDeps: entry:
    let
      ownRoot = cargoRootFor owner;
      external = !(lib.hasPrefix "${ownRoot}/" entry.path) && entry.path != ownRoot;
      matchingDeps = builtins.filter
        (dep: cargoRootFor dep == entry.path)
        directDeps;
      depName = if matchingDeps == [] then null else builtins.head matchingDeps;
      depPackage = if depName == null then null else packageFor depName;
      depNode = if depName == null then null else nodeFor depName;
      publicCrate = if depNode == null then "" else first [
        (ctx.get depNode "public_crate")
        (ctx.get depNode "crate")
        depPackage.name
      ];
      declaredFeatures = if depNode == null then [] else ctx.get depNode "features";
      depFeatures = if declaredFeatures == null then [] else declaredFeatures;
      depDefaultFeatures = if depNode == null then true else
        let value = ctx.get depNode "default_features";
        in if value == null then true else value;
      depTarget = if depNode == null then "" else ctx.get depNode "target";
      ownerTarget = ctx.get (nodeFor owner) "target";
      depProfile = if depNode == null then "" else ctx.get depNode "profile";
      ownerProfile = ctx.get (nodeFor owner) "profile";
      hostRole = if depNode == null then "target" else
        first [ (ctx.get depNode "host_role") "target" ];
    in if !external then null
    else if matchingDeps == [] then builtins.throw
      "Rust target ${owner} Cargo path dependency ${entry.key} points outside the declared Rust source closure: ${entry.path}"
    else if builtins.length matchingDeps != 1 then builtins.throw
      "Rust target ${owner} Cargo path dependency ${entry.key} ambiguously matches Buck dependencies: ${lib.concatStringsSep ", " matchingDeps}"
    else if !(builtins.elem depName directDeps) then builtins.throw
      "Rust target ${owner} Cargo path dependency ${entry.key} is missing its Buck dependency edge to ${depName}"
    else if entry.package != depPackage.name then builtins.throw
      "Rust target ${owner} Cargo dependency ${entry.key} selects package ${entry.package}, but ${depName} declares ${depPackage.name}"
    else if entry.key != publicCrate then builtins.throw
      "Rust target ${owner} Cargo dependency key ${entry.key} does not match public crate ${publicCrate} from ${depName}"
    else if !(Semver.versionCompatible entry.version depPackage.version) then builtins.throw
      "Rust target ${owner} Cargo dependency ${entry.key} version ${entry.version} is incompatible with ${depPackage.version}"
    else if builtins.sort (a: b: a < b) entry.features != builtins.sort (a: b: a < b) depFeatures
      || entry.defaultFeatures != depDefaultFeatures
    then builtins.throw
      "Rust target ${owner} Cargo dependency ${entry.key} feature constraints disagree with ${depName}"
    else if hostRole != "host" && depTarget != ownerTarget then builtins.throw
      "Rust target ${owner} Cargo dependency ${entry.key} target constraint disagrees with ${depName}"
    else if depProfile != ownerProfile then builtins.throw
      "Rust target ${owner} Cargo dependency ${entry.key} profile constraint disagrees with ${depName}"
    else depName;
  validateNode = name:
    let
      directDeps = rustDepNames (nodeFor name);
      crossDeps = builtins.filter
        (dep: cargoRootFor dep != cargoRootFor name)
        directDeps;
      checkedEntries = map (validateEntry name directDeps) (pathEntriesFor name);
      matched = builtins.filter (value: value != null) checkedEntries;
      missing = builtins.filter (dep: !(builtins.elem dep matched)) crossDeps;
    in builtins.deepSeq checkedEntries (if missing != [] then builtins.throw
      "Rust target ${name} has Buck dependencies without matching Cargo path dependencies: ${lib.concatStringsSep ", " missing}"
    else true);
  visit = path: name:
    if builtins.elem name path then builtins.throw
      "Rust cross-root dependency cycle: ${lib.concatStringsSep " -> " (path ++ [ name ])}"
    else lib.concatMap (visit (path ++ [ name ]))
      (rustDepNames (nodeFor name)) ++ [ name ];
  closureFor = name: lib.unique (visit [] name);
  recordFor = name:
    let
      node = nodeFor name;
      package = packageFor name;
      declaredPackage = ctx.get node "cargo_package";
      root = cargoRootFor name;
      patchDirs = ctx.get node "local_patch_dirs";
    in if declaredPackage != null && declaredPackage != package.name then builtins.throw
      "Rust target ${name} cargo_package ${declaredPackage} disagrees with member package ${package.name}"
    else {
      label = name;
      cargo_root = root;
      cargoRoot = builtins.toPath "${ctx.repoRootStr}/${root}";
      member_manifest = sourcePath name (ctx.get node "cargo_manifest");
      cargo_lock = cargoLockFor name;
      lock_identity = first [ (ctx.get node "cargo_lock_identity") (cargoLockFor name) ];
      package_id = "${package.name}@${package.version}";
      package_name = package.name;
      public_crate = first [ (ctx.get node "public_crate") (ctx.get node "crate") package.name ];
      crate_type = first [ (ctx.get node "crate_type") "rlib" ];
      host_role = first [ (ctx.get node "host_role") "target" ];
      generated_outputs = first [ (ctx.get node "generated_outputs") [] ];
      cargo_output_hashes = first [ (ctx.get node "cargo_output_hashes") {} ];
      cargo_fixed_sources = first [ (ctx.get node "cargo_fixed_sources") {} ];
      patchInputs = map
        (candidate: builtins.path {
          path = builtins.toPath candidate;
          name = "rust-package-patches";
        })
        (builtins.filter builtins.pathExists
          (map (dir: "${ctx.repoRootStr}/${root}/${dir}")
            (if patchDirs == null then [] else patchDirs)));
    };
in {
  mergeAuthorities = field: roots:
    lib.foldl' (result: root:
      lib.foldl' (merged: key:
        let value = root.${field}.${key};
        in if merged ? ${key} && merged.${key} != value then builtins.throw
          "Rust composed Cargo roots disagree on ${field} authority ${key}"
        else merged // { ${key} = value; })
      result
      (builtins.attrNames root.${field}))
    {}
    roots;

  compositionFor = name:
    let
      closure = closureFor name;
      validations = map validateNode closure;
      rootsByPath = lib.foldl' (result: target:
        let record = recordFor target;
        in result // { ${record.cargo_root} = record; }) {} closure;
      roots = builtins.attrValues rootsByPath;
      manifest = map (record: {
        inherit (record)
          label cargo_root member_manifest cargo_lock lock_identity package_id
          public_crate crate_type host_role generated_outputs;
      }) roots;
    in assert builtins.all (value: value) validations; {
      inherit roots manifest;
      digest = builtins.hashString "sha256" (builtins.toJSON manifest);
      diagnostics = map (record: {
        inherit (record) label cargo_root package_id public_crate crate_type host_role;
      }) roots;
      patchInputs = lib.unique (lib.concatMap (record: record.patchInputs) roots);
    };
}
