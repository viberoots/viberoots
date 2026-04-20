{ lib, config, pkgs, ... }:
let
  cfg = config.deploymentHost.identityProvider;
  localHost = "127.0.0.1";
  hostname = if cfg.hostname == null then "_disabled.invalid" else cfg.hostname;
  keycloakHttpPort = if cfg.keycloakHttpPort == null then 0 else cfg.keycloakHttpPort;
  publicUrl = "https://${hostname}";
  proxyUrl = "http://${localHost}:${toString keycloakHttpPort}";
in
{
  options.deploymentHost.identityProvider = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable the reviewed Keycloak identity-provider defaults for a deployment host.";
    };
    hostname = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public hostname for the deployment-host OIDC issuer.";
    };
    acmeEmail = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "ACME account email used when this module manages certificates.";
    };
    keycloakHttpPort = lib.mkOption {
      type = lib.types.nullOr lib.types.port;
      default = null;
      description = "Loopback HTTP port used by Keycloak behind nginx.";
    };
    databasePasswordFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/deployment-host-secrets/keycloak-db-password";
      description = "Out-of-store file containing the local Keycloak database password.";
    };
    manageNginx = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module manages the nginx virtual host.";
    };
    manageAcme = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module manages ACME defaults for the identity host.";
    };
    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether this module opens HTTP and HTTPS firewall ports.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.hostname != null;
        message = "deploymentHost.identityProvider.hostname must be set when the identity provider is enabled.";
      }
      {
        assertion = cfg.keycloakHttpPort != null;
        message = "deploymentHost.identityProvider.keycloakHttpPort must be set to an unused loopback port.";
      }
      {
        assertion = !cfg.manageAcme || cfg.acmeEmail != null;
        message = "deploymentHost.identityProvider.acmeEmail must be set when manageAcme is true.";
      }
    ];

    services.keycloak = {
      enable = true;
      package = lib.mkDefault pkgs.keycloak;
      database = {
        type = "postgresql";
        createLocally = true;
        passwordFile = cfg.databasePasswordFile;
      };
      settings = {
        hostname = lib.mkDefault publicUrl;
        http-enabled = lib.mkDefault true;
        http-host = lib.mkDefault localHost;
        http-port = lib.mkDefault keycloakHttpPort;
        proxy-headers = lib.mkDefault "xforwarded";
        hostname-backchannel-dynamic = lib.mkDefault true;
      };
    };

    services.nginx = lib.mkIf cfg.manageNginx {
      enable = lib.mkDefault true;
      virtualHosts.${hostname} = {
        forceSSL = lib.mkDefault true;
        enableACME = lib.mkDefault cfg.manageAcme;
        locations."/" = {
          proxyPass = lib.mkDefault proxyUrl;
          proxyWebsockets = lib.mkDefault true;
          extraConfig = lib.mkAfter ''
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port 443;
            proxy_set_header X-Forwarded-Proto https;
          '';
        };
      };
    };

    security.acme = lib.mkIf (cfg.manageNginx && cfg.manageAcme) {
      acceptTerms = lib.mkDefault true;
      defaults.email = lib.mkDefault cfg.acmeEmail;
    };

    networking.firewall = lib.mkIf cfg.openFirewall {
      enable = lib.mkDefault true;
      allowedTCPPorts = [ 80 443 ];
    };
    environment.systemPackages = with pkgs; [ config.services.keycloak.package curl jq ];
  };
}
