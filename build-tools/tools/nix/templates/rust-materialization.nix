{
  H, name, sourcePlan, artifactNixRoot, pkgs, compositionEvidence,
  producerLineage, wasmPostprocess, interopContract, dependencyInventory,
  pyemscriptenContract ? { enabled = false; config = {}; },
}:
{
  schemaVersion = "viberoots.nix-store-materialization.v1";
  sourceRevision = producerLineage.revision;
  compositionDigest = compositionEvidence.digest;
  sourceIdentity = producerLineage.sourceIdentity;
  sourceSnapshot = builtins.toString producerLineage.sourceSnapshot;
  packages = dependencyInventory;
  flakeLockFingerprint = sourcePlan.nixpkgs_profile;
  substituter = {
    endpointIdentity = "https://cache.home.kilty.io/main";
    trustedPublicKeys = [ "main:N7uIAritMCBWpa9cdZJxHJ7gWfsXCwAsbyIJqrSQnLY=" ];
  };
  tools = {
    nix = if artifactNixRoot == "" then builtins.toString pkgs.nix else artifactNixRoot;
    wasm = wasmPostprocess.passthru.toolIdentities;
    pyemscripten = if pyemscriptenContract.enabled then pyemscriptenContract.config else {};
  };
  artifacts = {
    pyemscripten = if pyemscriptenContract.enabled then pyemscriptenContract.installedShape else {};
  };
  storePaths = [{
    attr = H.sanitizeName name;
    path = "__VIBEROOTS_RUST_OUT__";
    expectedOutputIdentity = "__VIBEROOTS_RUST_IDENTITY__";
    provenancePath = "__VIBEROOTS_RUST_PROVENANCE__";
    expectedProvenanceIdentity = "__VIBEROOTS_RUST_PROVENANCE_IDENTITY__";
  }] ++ builtins.genList (index:
    let runtime = builtins.elemAt interopContract.runtimePackages index;
    in {
      attr = "interop-runtime-${builtins.toString index}";
      path = builtins.toString runtime;
      expectedOutputIdentity = baseNameOf (builtins.toString runtime);
    })
    (builtins.length interopContract.runtimePackages);
}
