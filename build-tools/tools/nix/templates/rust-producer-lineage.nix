{ sourceBundle, cargoLock, patchInputs }:
let
  canonicalSourceBundle = builtins.path {
    path = sourceBundle;
    name = "viberoots-rust-source";
  };
  canonicalPatchInputs = builtins.genList
    (index: builtins.path {
      path = builtins.elemAt patchInputs index;
      name = "viberoots-rust-patch-${builtins.toString index}";
    })
    (builtins.length patchInputs);
  sourceIdentity = {
    sourceBundle = builtins.toString canonicalSourceBundle;
    cargoLock = {
      path = "Cargo.lock";
      sha256 = builtins.hashFile "sha256" cargoLock;
    };
    patches = map builtins.toString canonicalPatchInputs;
  };
in {
  inherit sourceIdentity;
  sourceSnapshot = canonicalSourceBundle;
  revision = builtins.hashString "sha256" (builtins.toJSON sourceIdentity);
}
