{ config, lib, pkgs, ... }:
let
  cfg = config.deploymentHost.vault;
  acmeCertName = if cfg.acmeCertName == null then "_disabled.invalid" else cfg.acmeCertName;
  publicHostname = if cfg.publicHostname == null then "_disabled.invalid" else cfg.publicHostname;
  acmeCertDir = config.security.acme.certs.${acmeCertName}.directory;
  tlsCertFile = if cfg.useAcmeCertificate then "${acmeCertDir}/fullchain.pem" else cfg.tlsCertFile;
  tlsKeyFile = if cfg.useAcmeCertificate then "${acmeCertDir}/key.pem" else cfg.tlsKeyFile;
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
      default = false;
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
    useAcmeCertificate = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Use an existing ACME certificate directly for Vault TLS.";
    };
    acmeCertName = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Existing ACME certificate name that covers the Vault hostname.";
    };
    acmeGroup = lib.mkOption {
      type = lib.types.str;
      default = "deployment-acme";
      description = "Shared group allowed to read the selected ACME certificate.";
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
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public Vault hostname.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.useAcmeCertificate || cfg.acmeCertName != null;
        message = "deploymentHost.vault.acmeCertName must be set when useAcmeCertificate is true.";
      }
      {
        assertion = !cfg.addLocalHostname || cfg.publicHostname != null;
        message = "deploymentHost.vault.publicHostname must be set when addLocalHostname is true.";
      }
    ];

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

    users.groups.${cfg.acmeGroup}.members = lib.mkIf cfg.useAcmeCertificate [ "vault" ];
    security.acme.certs.${acmeCertName} = lib.mkIf cfg.useAcmeCertificate {
      group = lib.mkDefault cfg.acmeGroup;
      postRun = lib.mkAfter ''
        systemctl try-restart vault.service
      '';
    };
    systemd.services.vault = lib.mkIf cfg.useAcmeCertificate {
      after = [ "acme-${acmeCertName}.service" ];
      wants = [ "acme-${acmeCertName}.service" ];
    };
    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ 8200 ];
    networking.hosts."127.0.0.1" = lib.mkIf cfg.addLocalHostname [ publicHostname ];
    environment.systemPackages = [ config.services.vault.package ];
  };
}
