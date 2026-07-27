{ ctx }:
consumer: dependency: role: label:
let
  abiFor = node: import ./native-abi.nix {
    pkgs = (ctx.sourcePlanFor node).base_pkgs;
  };
  get = node: field: fallback:
    let value = ctx.get node field;
    in if value == null || value == "" then fallback else value;
  requireEqual = field: left: right:
    if left == right then true else builtins.throw
      "Rust interop ${role}_deps target ${label} has mismatched ${field}: ${builtins.toJSON left} != ${builtins.toJSON right}";
  interopKind = get consumer "interop_kind" "";
  standardField = if interopKind == "cxx" then "cxx_standard" else "c_standard";
  expectedStl = if interopKind == "cxx" then "libc++" else "none";
  dependencySurface = get dependency "module_surface" "";
  _surface = if builtins.match "native:v1:(lib|headers):(static|shared|none)" dependencySurface != null
    then true else builtins.throw
      "Rust interop ${role}_deps target ${label} has unsupported module_surface ${dependencySurface}";
  checks = [
    (requireEqual "nixpkgs_profile"
      (get consumer "nixpkgs_profile" "default")
      (get dependency "nixpkgs_profile" "default"))
    (requireEqual "nixpkg_pins"
      (get consumer "nixpkg_pins" {})
      (get dependency "nixpkg_pins" {}))
    (requireEqual "compiler_family"
      (get consumer "compiler_family" "llvm")
      (get dependency "compiler_family" "llvm"))
    (requireEqual "compiler_identity"
      ((abiFor consumer).resolveCompilerIdentity "Rust interop target" (get consumer "compiler_identity" ""))
      ((abiFor dependency).resolveCompilerIdentity label (get dependency "compiler_identity" "")))
    (requireEqual "target_triple"
      ((abiFor consumer).resolveTargetTriple "Rust interop target" (get consumer "target_triple" ""))
      ((abiFor dependency).resolveTargetTriple label (get dependency "target_triple" "")))
    (requireEqual standardField
      (get consumer standardField (if interopKind == "cxx" then "c++17" else "c11"))
      (get dependency "language_standard" (if interopKind == "cxx" then "c++17" else "c11")))
    (requireEqual "stl" (get consumer "stl" expectedStl) (get dependency "stl" expectedStl))
  ];
in if _surface && builtins.all (value: value) checks then label else label
