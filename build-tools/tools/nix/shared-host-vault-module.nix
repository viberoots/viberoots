{ config, lib, pkgs, ... }:
let
  cfg = config.deploymentHost.vault;
  acmeCertDir = config.security.acme.certs.${cfg.appsAcmeCertName}.directory;
  tlsCertFile =
    if cfg.useAppsAcmeCertificate then "${acmeCertDir}/fullchain.pem" else cfg.tlsCertFile;
  tlsKeyFile = if cfg.useAppsAcmeCertificate then "${acmeCertDir}/key.pem" else cfg.tlsKeyFile;
  tlsConfig = lib.optionalAttrs (tlsCertFile != null && tlsKeyFile != null) {
    inherit tlsCertFile tlsKeyFile;
  };
  renderedExtraConfig = ''
    ui = true
    disable_mlock = ${if cfg.disableMlock then "true" else "false"}
  ''
  + lib.optionalString (cfg.apiAddress != null) ''
    api_addr = "${cfg.apiAddress}"
  ''
  + lib.optionalString (cfg.clusterAddress != null) ''
    cluster_addr = "${cfg.clusterAddress}"
  '';
in
{
  options.deploymentHost.vault = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable the reviewed Vault service defaults for a deployment host.";
    };
    address = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1:8200";
      description = "Vault listener address.";
    };
    storageBackend = lib.mkOption {
      type = lib.types.str;
      default = "raft";
      description = "Vault storage backend.";
    };
    storagePath = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/vault";
      description = "Vault storage path.";
    };
    disableMlock = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Rendered Vault disable_mlock setting.";
    };
    apiAddress = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional public Vault API address.";
    };
    clusterAddress = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional public Vault cluster address.";
    };
    tlsCertFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional explicit Vault TLS certificate file.";
    };
    tlsKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional explicit Vault TLS key file.";
    };
    listenerExtraConfig = lib.mkOption {
      type = lib.types.lines;
      default = "";
      description = "Additional Vault listener configuration.";
    };
    useAppsAcmeCertificate = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Use the existing apps.kilty.io ACME certificate directly for Vault TLS.";
    };
    appsAcmeCertName = lib.mkOption {
      type = lib.types.str;
      default = "apps.kilty.io";
      description = "Existing ACME certificate name that covers the Vault hostname.";
    };
    appsAcmeGroup = lib.mkOption {
      type = lib.types.str;
      default = "apps-acme";
      description = "Shared group allowed to read the apps wildcard certificate.";
    };
    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module opens the Vault listener port.";
    };
    addLocalHostname = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module maps the public Vault hostname to loopback.";
    };
    publicHostname = lib.mkOption {
      type = lib.types.str;
      default = "secrets.apps.kilty.io";
      description = "Public Vault hostname.";
    };
  };

  config = lib.mkIf cfg.enable {
    nixpkgs.config.allowUnfreePredicate = lib.mkDefault (
      pkg: builtins.elem (lib.getName pkg) [ "vault" ]
    );

    services.vault = {
      enable = true;
      package = lib.mkDefault pkgs.vault;
      address = lib.mkDefault cfg.address;
      storageBackend = lib.mkDefault cfg.storageBackend;
      storagePath = lib.mkDefault cfg.storagePath;
      extraConfig = lib.mkAfter renderedExtraConfig;
      listenerExtraConfig = lib.mkAfter cfg.listenerExtraConfig;
    } // tlsConfig;

    users.groups.${cfg.appsAcmeGroup}.members = lib.mkIf cfg.useAppsAcmeCertificate [ "vault" ];
    security.acme.certs.${cfg.appsAcmeCertName} = lib.mkIf cfg.useAppsAcmeCertificate {
      group = lib.mkDefault cfg.appsAcmeGroup;
      postRun = lib.mkAfter ''
        systemctl try-restart vault.service
      '';
    };
    systemd.services.vault = lib.mkIf cfg.useAppsAcmeCertificate {
      after = [ "acme-${cfg.appsAcmeCertName}.service" ];
      wants = [ "acme-${cfg.appsAcmeCertName}.service" ];
    };
    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ 8200 ];
    networking.hosts."127.0.0.1" = lib.mkIf cfg.addLocalHostname [ cfg.publicHostname ];
    environment.systemPackages = [ config.services.vault.package ];
  };
}
