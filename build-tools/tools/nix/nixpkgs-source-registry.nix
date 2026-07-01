{ inputs ? { } }:

let
  nixpkgsInput = inputs.nixpkgs or null;
in
{
  schemaVersion = "nixpkgs-source-registry@1";

  profiles.default = {
    input = nixpkgsInput;
    rationale = "Default viberoots nixpkgs input.";
    supportedSystems = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
}
