{ lib, pkgs, ... }:
{
  nixpkgs.config.allowUnfreePredicate = lib.mkDefault (pkg: builtins.elem (lib.getName pkg) [
    "vault"
  ]);

  services.vault = {
    enable = true;
    package = lib.mkDefault pkgs.vault;
    address = lib.mkDefault "127.0.0.1:8200";
    storageBackend = lib.mkDefault "raft";
    storagePath = lib.mkDefault "/var/lib/vault";
    extraConfig = lib.mkAfter ''
      ui = true
    '';
  };

  environment.systemPackages = [ pkgs.vault ];
}
