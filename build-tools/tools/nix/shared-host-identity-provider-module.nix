{ lib, config, pkgs, ... }:
let
  cfg = config.deploymentHost.identityProvider;
  localHost = "127.0.0.1";
  proxyUrl = "http://${localHost}:${toString cfg.keycloakHttpPort}";
in
{
  options.deploymentHost.identityProvider = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable the reviewed Keycloak identity-provider defaults for a deployment host.";
    };
    hostname = lib.mkOption {
      type = lib.types.str;
      default = "identity.apps.kilty.io";
      description = "Public hostname for the deployment-host OIDC issuer.";
    };
    acmeEmail = lib.mkOption {
      type = lib.types.str;
      default = "ops@example.com";
      description = "ACME account email used when this module manages certificates.";
    };
    keycloakHttpPort = lib.mkOption {
      type = lib.types.port;
      default = 8081;
      description = "Loopback HTTP port used by Keycloak behind nginx.";
    };
    databasePasswordFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/deployment-host-secrets/keycloak-db-password";
      description = "Out-of-store file containing the local Keycloak database password.";
    };
    manageNginx = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether this module manages the nginx virtual host.";
    };
    manageAcme = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether this module manages ACME defaults for the identity host.";
    };
    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether this module opens HTTP and HTTPS firewall ports.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.keycloak = {
      enable = true;
      package = lib.mkDefault pkgs.keycloak;
      database = {
        type = "postgresql";
        createLocally = true;
        passwordFile = cfg.databasePasswordFile;
      };
      settings = {
        hostname = lib.mkDefault cfg.hostname;
        http-enabled = lib.mkDefault true;
        http-host = lib.mkDefault localHost;
        http-port = lib.mkDefault cfg.keycloakHttpPort;
        proxy-headers = lib.mkDefault "xforwarded";
        hostname-backchannel-dynamic = lib.mkDefault true;
      };
    };

    services.nginx = lib.mkIf cfg.manageNginx {
      enable = lib.mkDefault true;
      virtualHosts.${cfg.hostname} = {
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
