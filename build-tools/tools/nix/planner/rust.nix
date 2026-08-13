{ lib }: ctx:
let
  P = import ./lib.nix { inherit lib; get = ctx.get; }; clean = P.cleanLabel;
  pythonDepsFor = import ./rust-python-deps.nix { inherit P ctx normalizeList; };
  overrideEnv = "NIX_RUST_DEV_OVERRIDE_JSON"; rustDevOverrides = (ctx.languageOverrides or {}).${overrideEnv} or {};
  _overrideClassification =
    if rustDevOverrides != {}
       && (ctx.evaluationClassification or "") != "local-development"
    then builtins.throw
      "Rust dev overrides require an explicit local-development evaluation bundle"
    else true;
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
  byName = builtins.listToAttrs (map (node: {
    name = clean (P.nameOf node);
    value = node;
  }) ctx.nodes);
  LC = import ./link-closure.nix { inherit lib; };
  normalizeList = field: value:
    if value == null then []
    else if builtins.isList value && builtins.all builtins.isString value then map clean value
    else builtins.throw "Rust planner ${field} must be a list of labels";
  sanitizeNativeLinkName = value:
    lib.replaceStrings [ "//" ":" "/" " " ] [ "" "-" "-" "-" ] value;
  runtimePackagesFor = import ./rust-runtime-deps.nix { inherit lib ctx normalizeList; }; validateInteropProfile = import ./rust-interop-profile.nix { inherit ctx; };
  Wasm = import ./rust-wasm.nix { inherit lib P ctx nodeFor normalizeList; }; Tauri = import ./rust-tauri.nix { inherit lib P ctx nodeFor normalizeList sourcePath; };
  nativeInputsForOne = name:
    let
      node = nodeFor name;
      interopKind = ctx.get node "interop_kind"; interopConsumer = interopKind != null && interopKind != "";
      linkDeps = normalizeList "link_deps" (ctx.get node "link_deps"); headerDeps = normalizeList "header_deps" (ctx.get node "header_deps");
      closureRaw = ctx.get node "link_closure";
      closure = if closureRaw == null then "direct" else closureRaw;
      overridesRaw = ctx.get node "link_closure_overrides";
      overrides = if overridesRaw == null then {} else
        builtins.listToAttrs (map (key: { name = clean key; value = overridesRaw.${key}; })
          (builtins.attrNames overridesRaw));
      missingOverrides = builtins.filter (key: !(builtins.elem key linkDeps)) (builtins.attrNames overrides);
      _overrides = if missingOverrides == [] then true else builtins.throw
        "Rust planner link_closure_overrides contains keys not present in link_deps: ${builtins.toString missingOverrides}";
      linkDepsOf = dep:
        normalizeList "link_deps for ${dep}" (ctx.get (nodeFor dep) "link_deps");
      resolved = LC.resolveLinkClosure {
        inherit byName overrides;
        roots = linkDeps;
        defaultClosure = closure;
        linkDepsOf = linkDepsOf;
      };
      validate = role: dep:
        let depNode = nodeFor dep; labels = P.labelsOf depNode;
        in if builtins.elem "lang:cpp" labels
          && (builtins.elem "kind:lib" labels || (role == "header" && builtins.elem "kind:headers" labels))
        then if interopConsumer then validateInteropProfile node depNode role dep else dep
        else builtins.throw
          "Rust planner ${role}_deps contains unsupported target ${dep}; expected a native C/C++ library${if role == "header" then " or headers target" else ""}";
      nativeLinkFor = dep:
        let mode = ctx.get (nodeFor dep) "link_mode";
        in {
          name = sanitizeNativeLinkName dep;
          kind = if mode == "shared" then "dylib" else "static";
        };
    in assert _overrides; {
      libraries = map (dep: ctx.dependencyArtifactOf (validate "link" dep)) resolved;
      headers = map (dep: ctx.dependencyArtifactOf (validate "header" dep)) headerDeps;
      linkNames = map sanitizeNativeLinkName resolved;
      nativeLinks = map nativeLinkFor resolved;
    };
  nativeInputsFor = names:
    let inputs = map nativeInputsForOne names;
    in {
      libraries = lib.unique (lib.concatMap (input: input.libraries) inputs);
      headers = lib.unique (lib.concatMap (input: input.headers) inputs);
      linkNames = lib.unique (lib.concatMap (input: input.linkNames) inputs);
      nativeLinks = lib.unique (lib.concatMap (input: input.nativeLinks) inputs);
    };
  pyemscriptenInputsFor = import ./rust-pyemscripten-inputs.nix {
    inherit lib P ctx nodeFor normalizeList sanitizeNativeLinkName LC byName;
  };
  pathContract = import ./rust-path-contract.nix {
    inherit lib P ctx nodeFor packagePath sourcePath normalizeList Wasm;
  };
  inherit (pathContract) cargoRootFor cargoLockFor nixpkgAttrsFor validateKindTarget
    validateNativeInputBoundary validatePatchDir;
  composition = import ./rust-composition.nix {
    inherit lib P ctx nodeFor rustNodes clean packagePath sourcePath cargoRootFor cargoLockFor;
  };
  build = kind: name:
    let
      node = nodeFor name;
      rootRel = cargoRootFor name;
      manifestRel = sourcePath name (ctx.get node "cargo_manifest");
      lockRel = cargoLockFor name;
      crate = ctx.get node "crate";
      sourceComposition = composition.compositionFor name;
      cargoOutputHashes = composition.mergeAuthorities
        "cargo_output_hashes" sourceComposition.roots;
      rawCargoFixedSources = builtins.mapAttrs (_: builtins.fromJSON)
        (composition.mergeAuthorities "cargo_fixed_sources" sourceComposition.roots);
      cargoFixedSources = lib.mapAttrs (key: fixed:
        if !(fixed ? bundlePath) then fixed
        else if !lib.hasPrefix "projects/" fixed.bundlePath
          || !lib.hasInfix "/.viberoots-fixed-sources/" fixed.bundlePath
          || lib.hasInfix ".." fixed.bundlePath
        then builtins.throw "Rust fixed-source bundle path is invalid for ${key}"
        else (builtins.removeAttrs fixed [ "bundlePath" ]) // {
          storePath = builtins.path {
            path = builtins.toPath "${ctx.repoRootStr}/${fixed.bundlePath}";
            name = "viberoots-rust-fixed-${builtins.hashString "sha256" key}";
            sha256 = fixed.narHash;
          };
        }) rawCargoFixedSources;
      features = ctx.get node "features";
      defaultFeatures = ctx.get node "default_features";
      behaviorProbe = ctx.get node "behavior_probe";
      profile = ctx.get node "profile";
      target = validateKindTarget name kind (ctx.get node "target");
      crateTypeRaw = ctx.get node "crate_type";
      crateType =
        if crateTypeRaw != null then crateTypeRaw
        else if kind == "lib" then "rlib"
        else if kind == "test" then "test"
        else if builtins.elem kind [ "wasm_static" "wasi_static" ] then "staticlib"
        else if builtins.elem kind [ "wasm" "wasm_browser" "wasm_component" ] then "cdylib"
        else "bin";
      hostRoleRaw = ctx.get node "host_role";
      hostRole = if hostRoleRaw == null then "target" else hostRoleRaw;
      publicCrateRaw = ctx.get node "public_crate";
      generatedOutputsRaw = ctx.get node "generated_outputs";
      module = ctx.get node "module";
      runtimeDeps = normalizeList "runtime_deps" (ctx.get node "runtime_deps");
      addonName = ctx.get node "addon_name"; nodeApiVersion = ctx.get node "node_api_version";
      platform = ctx.get node "platform";
      pythonAbi = ctx.get node "python_abi";
      _nativeInputBoundary = validateNativeInputBoundary name kind;
      patchDirs = ctx.get node "local_patch_dirs";
      cargoRoot = builtins.toPath "${ctx.repoRootStr}/${rootRel}";
      cargoManifest = builtins.toPath "${ctx.repoRootStr}/${manifestRel}";
      cargoLock = builtins.toPath "${ctx.repoRootStr}/${lockRel}";
      validatedPatchDirs = map (validatePatchDir name) (if patchDirs == null then [] else patchDirs);
      patchCandidates = map (dir: "${ctx.repoRootStr}/${rootRel}/${dir}") validatedPatchDirs; patchInputs = map (candidate: builtins.path { path = builtins.toPath candidate;
        name = "rust-package-patches"; }) (builtins.filter builtins.pathExists patchCandidates);
      nixpkgAttrs = nixpkgAttrsFor name;
      nixpkgRecords = ctx.resolveNixpkgAttrs { target = node; attrs = nixpkgAttrs; };
      missing = builtins.filter (record: record.package == null) nixpkgRecords;
      sourcePlan = ctx.sourcePlanFor node;
      interop = import ./rust-interop.nix {
        inherit ctx node name sourcePath;
        pkgs = sourcePlan.base_pkgs;
      };
      template = ctx.T.rustForPkgs sourcePlan.base_pkgs;
      pythonDeps = pythonDepsFor { inherit name node sourcePlan; };
      wasmContractRaw = Wasm.contractFor name kind;
      wasmContract = wasmContractRaw // lib.optionalAttrs (Wasm.isWasmKind kind) {
        header = if wasmContractRaw.header == null then null else
          builtins.toPath "${ctx.repoRootStr}/${sourcePath name wasmContractRaw.header}";
        wit = if wasmContractRaw.wit == null then null else
          builtins.toPath "${ctx.repoRootStr}/${sourcePath name wasmContractRaw.wit}";
      };
      nativeInputs = if kind == "pyext_wasm"
        then pyemscriptenInputsFor name
        else if Wasm.isWasmKind kind
        then Wasm.inputsFor name kind
        else nativeInputsFor (map (root: root.label) sourceComposition.roots);
      _pyextWasmCrateType =
        if kind == "pyext_wasm" && crateType != "cdylib" then builtins.throw
          "Rust Pyodide extension ${name} requires crate_type cdylib"
        else true;
      tauri = if kind == "tauri"
        then Tauri.contractFor name sourcePlan.base_pkgs.stdenv.hostPlatform.system
        else {};
    in if missing != [] then builtins.throw
      "Rust planner unresolved nixpkg deps for ${name}: ${lib.concatStringsSep ", " (map (record: record.attr) missing)}"
    else assert _nativeInputBoundary; assert _overrideClassification;
    assert _pyextWasmCrateType; template.rustPackage {
      inherit name kind cargoRoot cargoManifest cargoLock cargoOutputHashes cargoFixedSources sourcePlan sourceComposition;
      inherit nativeInputs;
      artifactNixRoot = ctx.declaredArtifactNixRoot or "";
      patchInputs = lib.unique (patchInputs ++ sourceComposition.patchInputs);
      devOverrides = rustDevOverrides;
      nixpkgDeps = map (record: record.package) nixpkgRecords;
      crate = if crate == null then lib.last (lib.splitString ":" name) else crate;
      features = if features == null then [] else features;
      defaultFeatures = if defaultFeatures == null then true else defaultFeatures;
      profile = if profile == null then "release" else profile;
      inherit crateType hostRole;
      publicCrate = if publicCrateRaw == null
        then lib.replaceStrings [ "-" ] [ "_" ]
          (if crate == null then lib.last (lib.splitString ":" name) else crate)
        else publicCrateRaw;
      generatedOutputs = if generatedOutputsRaw == null then [] else generatedOutputsRaw;
      inherit target;
      module = if module == null then "" else module;
      inherit (pythonDeps) buildPyDeps pythonWheelhouse;
      runtimePackages = runtimePackagesFor runtimeDeps;
      addonName = if addonName == null then "" else addonName;
      nodeApiVersion = if nodeApiVersion == null then 0 else nodeApiVersion;
      platform = if platform == null then "" else platform;
      pythonAbi = if pythonAbi == null then "" else pythonAbi;
      inherit interop;
      wasm = wasmContract;
      inherit tauri;
      behaviorProbe = behaviorProbe == true;
      coverage = ctx.coverageEnabled or false;
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
    config = import ./rust-kind-config.nix;
  };
  modulesFileFor = _: null;
  mkApp = build "bin"; mkAddon = build "addon"; mkLib = build "lib"; mkTest = build "test";
  mkPyExt = build "pyext"; mkPyExtWasm = build "pyext_wasm"; mkTauri = build "tauri";
  mkWasi = build "wasi"; mkWasm = build "wasm"; mkWasmBrowser = build "wasm_browser";
  mkWasmComponent = build "wasm_component"; mkWasmStatic = build "wasm_static"; mkWasiStatic = build "wasi_static";
}
