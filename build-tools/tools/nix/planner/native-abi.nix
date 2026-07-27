{ pkgs ? null
, selectedTargetTriple ? null
, selectedCompilerIdentity ? null
}:
let
  targetTriple =
    if selectedTargetTriple != null then selectedTargetTriple
    else pkgs.stdenv.targetPlatform.rust.rustcTargetSpec;
  compilerIdentity =
    if selectedCompilerIdentity != null then selectedCompilerIdentity
    else builtins.toString pkgs.llvmPackages.clang;
  resolveTargetTriple = owner: claimed:
    if claimed == targetTriple then targetTriple else builtins.throw
      "${owner} target_triple must match selected target ${targetTriple}; got ${builtins.toJSON claimed}";
  resolveCompilerIdentity = owner: claimed:
    if claimed == "selected-llvm" then compilerIdentity else builtins.throw
      "${owner} compiler_identity must resolve from the selected pinned LLVM toolchain; got ${builtins.toJSON claimed}";
in {
  inherit resolveCompilerIdentity resolveTargetTriple;
  selectedCompilerIdentity = compilerIdentity;
  selectedTargetTriple = targetTriple;
}
