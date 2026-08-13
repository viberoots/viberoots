{ lib, P, ctx, nodeFor, packagePath, sourcePath, normalizeList, Wasm }:
let
  nixpkgAttrsFor = name:
    let labels = P.labelsOf (nodeFor name);
    in builtins.sort (a: b: a < b) (map (lib.removePrefix "nixpkg:")
      (builtins.filter (label: lib.hasPrefix "nixpkg:" label) labels));
  cargoRootFor = name:
    let
      node = nodeFor name;
      manifest = ctx.get node "cargo_manifest";
      manifestRel = if manifest == null then "" else sourcePath name manifest;
      declaredRoot = ctx.get node "cargo_root";
      root = if declaredRoot == null || declaredRoot == ""
        then dirOf manifestRel else sourcePath name declaredRoot;
      expected = packagePath name;
      packageLocal = root == expected || lib.hasPrefix "${expected}/" root;
      canonical = "${root}/Cargo.toml";
    in if manifest == null then builtins.throw "Rust target ${name} is missing cargo_manifest"
       else if !packageLocal then builtins.throw
         "Rust target ${name} Cargo root must remain within package ${expected}; got ${root}"
       else if manifestRel != canonical then builtins.throw
         "Rust target ${name} cargo_manifest must be canonical package-local ${canonical}; got ${manifestRel}"
       else root;
  cargoLockFor = name:
    let
      node = nodeFor name;
      lock = ctx.get node "cargo_lock";
      lockRel = if lock == null then "" else sourcePath name lock;
      canonical = "${cargoRootFor name}/Cargo.lock";
    in if lock == null then builtins.throw "Rust target ${name} is missing cargo_lock"
       else if lockRel != canonical then builtins.throw
         "Rust target ${name} cargo_lock must be canonical package-local ${canonical}; got ${lockRel}"
       else lockRel;
  validatePatchDir = name: value:
    let
      raw = builtins.toString value;
      parts = lib.splitString "/" raw;
      invalidPart = builtins.any (part: part == "" || part == "." || part == "..") parts;
    in if raw == "" || lib.hasPrefix "/" raw || lib.hasInfix "\\" raw
      || lib.hasInfix ":" raw || invalidPart
    then builtins.throw "Rust target ${name} local_patch_dirs must remain within the package: ${raw}"
    else raw;
  validateKindTarget = name: kind: value:
    let
      target = if value == null then "" else builtins.toString value;
      expected =
        if kind == "pyext_wasm" then "wasm32-unknown-emscripten"
        else if Wasm.isWasmKind kind then (Wasm.contractFor name kind).target
        else "";
    in if target == expected then target else builtins.throw
      "Rust planner target ${name} kind ${kind} requires target ${if expected == "" then "<empty>" else expected}; got ${if target == "" then "<empty>" else target}";
  validateNativeInputBoundary = name: kind:
    let
      node = nodeFor name;
      headerDeps = normalizeList "header_deps" (ctx.get node "header_deps");
      nixpkgAttrs = nixpkgAttrsFor name;
    in if Wasm.isWasmKind kind && (headerDeps != [] || nixpkgAttrs != [])
      then builtins.throw
        "Rust planner target ${name} kind ${kind} does not support header_deps or nixpkg dependencies"
      else true;
in {
  inherit cargoRootFor cargoLockFor nixpkgAttrsFor validateKindTarget
    validateNativeInputBoundary validatePatchDir;
}
