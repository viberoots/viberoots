{ lib, config, pkgs, ... }:
{
  services.postgresql = {
    enable = true;
    package = lib.mkOverride 900 pkgs.postgresql_16;
    enableTCPIP = true;
    settings = {
      listen_addresses = lib.mkForce "127.0.0.1";
      port = lib.mkDefault 5432;
    };
    ensureDatabases = [ "deployctl" ];
    ensureUsers = [
      {
        name = "deployctl";
        ensureDBOwnership = true;
      }
    ];
    authentication = lib.mkAfter ''
      host  deployctl  deployctl  127.0.0.1/32  scram-sha-256
      host  deployctl  deployctl  ::1/128       scram-sha-256
    '';
  };

  environment.systemPackages = [ config.services.postgresql.package ];
}
