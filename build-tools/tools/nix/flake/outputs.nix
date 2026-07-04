{ self, nixpkgs, buck2, gomod2nix }:
let
  version = "0.0.0-dev";
  releaseTag = "v${version}";
  mkWorkspace =
    { workspaceSrc
    , viberootsInput ? self
    , workspaceName ? "viberoots"
    , nixpkgsRegistryExtension ? { profiles = { }; }
    }:
      import ./workspace.nix {
        inherit nixpkgs buck2 gomod2nix workspaceSrc viberootsInput workspaceName version releaseTag nixpkgsRegistryExtension;
      };
  workspace = mkWorkspace {
    workspaceSrc = ../../../..;
    viberootsInput = self;
    workspaceName = "viberoots";
  };
in
workspace // {
  lib = workspace.lib // {
    inherit mkWorkspace version releaseTag;
  };
}
