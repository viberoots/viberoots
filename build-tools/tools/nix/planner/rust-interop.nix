{ ctx, node, name, sourcePath, pkgs }:
let
  ABI = import ./native-abi.nix { inherit pkgs; };
  read = field:
    let value = ctx.get node field;
    in if value == null then "" else value;
  bindingConfigRaw = read "binding_config";
in {
  bindingConfig = if bindingConfigRaw == ""
    then null
    else builtins.path {
      path = builtins.toPath "${ctx.repoRootStr}/${sourcePath name bindingConfigRaw}";
      name = "rust-interop-bindings.json";
    };
  interopKind = read "interop_kind";
  interopGenerator = read "interop_generator";
  panicStrategy = read "panic_strategy";
  exceptionPolicy = read "exception_policy";
  allocator = read "allocator";
  threadSafety = read "thread_safety";
  cxxStandard = read "cxx_standard";
  cStandard = read "c_standard";
  compilerFamily = read "compiler_family";
  compilerIdentity = ABI.resolveCompilerIdentity name (read "compiler_identity");
  stl = read "stl";
  moduleSurface = read "module_surface";
  targetTriple = ABI.resolveTargetTriple name (read "target_triple");
}
